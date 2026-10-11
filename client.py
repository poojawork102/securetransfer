"""
SecureTransfer CLIENT — splits a file into chunks and sends them with stop-and-wait ARQ:
every DATA frame waits for ACK; on NACK or timeout the chunk is retransmitted.

Run:  python client.py sample_files/sample.txt [--hmac] [--fec] [--chunk 1024] [--port 8000]
      (port 8000 = through the proxy/channel, 9000 = directly to the server)
"""
import argparse
import hashlib
import json
import math
import os
import socket
import time

import config
import protocol as P
import telemetry

C = {"g": "\033[92m", "r": "\033[91m", "y": "\033[93m", "b": "\033[94m", "m": "\033[95m",
     "c": "\033[96m", "x": "\033[0m", "d": "\033[2m"}


class TransferError(Exception):
    pass


def send_file(path, host=config.HOST, port=config.PROXY_PORT, *, chunk_size=config.DEFAULT_CHUNK_SIZE,
              use_hmac=False, use_fec=False, key=config.SHARED_KEY, delay_ms=0,
              max_retries=config.MAX_RETRIES, timeout=config.ACK_TIMEOUT_S, quiet=False):
    """Send one file. Returns a stats dict. Raises TransferError on unrecoverable failure."""

    def log(msg, color="x"):
        if not quiet:
            print(f"{C['d']}{time.strftime('%H:%M:%S')}{C['x']} {C[color]}[CLIENT]{C['x']} {msg}", flush=True)

    with open(path, "rb") as f:
        blob = f.read()
    size = len(blob)
    n_chunks = max(1, math.ceil(size / chunk_size))
    sha = hashlib.sha256(blob).hexdigest()
    name = os.path.basename(path)
    frame_kw = dict(use_hmac=use_hmac, use_fec=use_fec, key=key)

    stats = {"file": name, "size": size, "chunks": n_chunks, "chunk_size": chunk_size,
             "hmac": use_hmac, "fec": use_fec, "retransmits": 0, "nacks": 0, "timeouts": 0,
             "rtts_ms": [], "bytes_on_wire": 0}

    telemetry.emit("client", "start", file=name, size=size, chunks=n_chunks, chunk_size=chunk_size,
                   hmac=use_hmac, fec=use_fec, sha256=sha)
    log(f"sending '{name}' ({size} B) in {n_chunks} chunks of {chunk_size} B to {host}:{port} "
        f"[HMAC {'on' if use_hmac else 'off'} | Hamming {'on' if use_fec else 'off'}]", "c")

    try:
        sock = socket.create_connection((host, port), timeout=timeout)
    except OSError as e:
        telemetry.emit("client", "error", msg=f"cannot connect to {host}:{port} ({e})")
        raise TransferError(f"cannot connect to {host}:{port}: {e}") from e
    sock.settimeout(timeout)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def transact(frame_bytes, seq, label):
        """Send a frame and wait for a valid ACK, retrying on NACK/timeout. Returns RTT in ms."""
        for attempt in range(1, max_retries + 1):
            t0 = time.perf_counter()
            sock.sendall(frame_bytes)
            stats["bytes_on_wire"] += len(frame_bytes)
            if label == "DATA":
                telemetry.emit("client", "send", seq=seq, attempt=attempt)
            try:
                reply = P.read_frame(sock)
                # a late ACK for an earlier chunk (after a timeout-retransmit) — ignore and keep waiting
                while reply.type in (P.ACK, P.NACK) and label == "DATA" and reply.seq < seq:
                    reply = P.read_frame(sock)
            except socket.timeout:
                stats["timeouts"] += 1
                stats["retransmits"] += 1
                log(f"{label} {seq} timeout (attempt {attempt}) -> retransmit", "y")
                telemetry.emit("client", "timeout", seq=seq, attempt=attempt)
                continue
            rtt = (time.perf_counter() - t0) * 1000
            _, rstatus, _ = P.open_frame(reply, key)
            if reply.type == P.ACK and reply.seq == seq and rstatus in (P.OK, P.CORRECTED):
                if label == "DATA":
                    telemetry.emit("client", "ack", seq=seq, attempt=attempt, rtt_ms=round(rtt, 3))
                return rtt
            if reply.type == P.ERR:
                raise TransferError(f"server error: {reply.payload.decode(errors='replace')}")
            reason = reply.payload.decode(errors="replace") if reply.type == P.NACK else "bad ack"
            stats["nacks"] += 1
            stats["retransmits"] += 1
            log(f"{label} {seq} NACK ({reason}) -> retransmit #{attempt}", "r" if reason != "hmac_fail" else "m")
            telemetry.emit("client", "nack", seq=seq, attempt=attempt, reason=reason)
        raise TransferError(f"{label} {seq} failed after {max_retries} attempts")

    t_start = time.perf_counter()
    try:
        meta = json.dumps({"name": name, "size": size, "chunks": n_chunks,
                           "chunk_size": chunk_size, "sha256": sha}).encode()
        transact(P.build_frame(P.META, 0, meta, **frame_kw), 0, "META")

        for seq in range(n_chunks):
            chunk = blob[seq * chunk_size:(seq + 1) * chunk_size]
            rtt = transact(P.build_frame(P.DATA, seq, chunk, **frame_kw), seq, "DATA")
            stats["rtts_ms"].append(round(rtt, 3))
            elapsed = time.perf_counter() - t_start
            done_bytes = min(size, (seq + 1) * chunk_size)
            telemetry.emit("client", "progress", seq=seq, done=done_bytes,
                           throughput_kbps=round(done_bytes / 1024 / max(elapsed, 1e-6), 1))
            if not quiet and (seq % max(1, n_chunks // 10) == 0 or seq == n_chunks - 1):
                log(f"chunk {seq + 1}/{n_chunks} ACK  rtt={rtt:.2f} ms", "g")
            if delay_ms:
                time.sleep(delay_ms / 1000)

        sock.sendall(P.build_frame(P.DONE, n_chunks, b"", **frame_kw))
        reply = P.read_frame(sock)
        result = json.loads(P.open_frame(reply, key)[0]) if reply.type == P.RESULT else {}
    except (ConnectionError, OSError) as e:
        telemetry.emit("client", "error", msg=f"connection lost: {e}")
        raise TransferError(f"connection lost: {e}") from e
    except TransferError as e:
        telemetry.emit("client", "error", msg=str(e))
        raise
    finally:
        sock.close()

    elapsed = time.perf_counter() - t_start
    rtts = stats["rtts_ms"]
    stats.update({
        "elapsed_s": round(elapsed, 4),
        "throughput_kbps": round(size / 1024 / max(elapsed, 1e-6), 2),
        "avg_rtt_ms": round(sum(rtts) / len(rtts), 3) if rtts else 0,
        "jitter_ms": round(sum(abs(rtts[i] - rtts[i - 1]) for i in range(1, len(rtts))) / max(1, len(rtts) - 1), 3),
        "overhead_pct": round((stats["bytes_on_wire"] - size) / max(size, 1) * 100, 2),
        "verified": bool(result.get("match")),
        "server_stats": result.get("stats", {}),
    })
    telemetry.emit("client", "done", **{k: v for k, v in stats.items() if k != "rtts_ms"})
    if stats["verified"]:
        log(f"VERIFIED ✔ SHA-256 match | {elapsed:.3f}s | {stats['throughput_kbps']} KB/s | "
            f"retransmits {stats['retransmits']}", "g")
    else:
        log(f"FILE CORRUPTED ✘ SHA-256 mismatch — every chunk passed CRC but the file is wrong!", "r")
    return stats


def main():
    ap = argparse.ArgumentParser(description="SecureTransfer client")
    ap.add_argument("file")
    ap.add_argument("--host", default=config.HOST)
    ap.add_argument("--port", type=int, default=config.PROXY_PORT,
                    help="8000 = via proxy/channel (default), 9000 = direct to server")
    ap.add_argument("--chunk", type=int, default=config.DEFAULT_CHUNK_SIZE)
    ap.add_argument("--hmac", action="store_true", help="add HMAC-SHA256 authentication")
    ap.add_argument("--fec", action="store_true", help="Hamming(7,4) forward error correction")
    ap.add_argument("--delay", type=int, default=0, help="ms pause between chunks (for demos)")
    a = ap.parse_args()
    try:
        s = send_file(a.file, a.host, a.port, chunk_size=a.chunk, use_hmac=a.hmac, use_fec=a.fec,
                      delay_ms=a.delay)
        print(json.dumps({k: v for k, v in s.items() if k != "rtts_ms"}, indent=2))
    except TransferError as e:
        print(f"{C['r']}[CLIENT] transfer failed: {e}{C['x']}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
