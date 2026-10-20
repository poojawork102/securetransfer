"""
SecureTransfer CLIENT -- splits a file into chunks and sends them with stop-and-wait ARQ:
every DATA frame waits for ACK; on NACK or timeout the chunk is retransmitted.

Run:  python client.py sample_files/sample.txt [--fec] [--check crc32|checksum16] [--chunk 1024]
      (port 8000 = through the proxy/channel, 9000 = directly to the server)
"""
import argparse
import hashlib
import json
import math
import os
import socket
import struct
import time

import config
import protocol as P
import telemetry

C = {"g": "\033[92m", "r": "\033[91m", "y": "\033[93m", "b": "\033[94m",
     "c": "\033[96m", "x": "\033[0m", "d": "\033[2m"}


class TransferError(Exception):
    def __init__(self, msg, stats=None):
        super().__init__(msg)
        self.stats = stats or {}


def _make_log(quiet):
    def log(msg, color="x"):
        if not quiet:
            print(f"{C['d']}{time.strftime('%H:%M:%S')}{C['x']} {C[color]}[CLIENT]{C['x']} {msg}", flush=True)
    return log


def send_file(path, host=config.HOST, port=config.PROXY_PORT, *, chunk_size=config.DEFAULT_CHUNK_SIZE,
              use_fec=False, delay_ms=0, max_retries=config.MAX_RETRIES,
              timeout=config.ACK_TIMEOUT_S, quiet=False, check="checksum16"):
    """Send one file. Returns a stats dict. Raises TransferError on unrecoverable failure."""
    log = _make_log(quiet)
    with open(path, "rb") as f:
        blob = f.read()
    size, name = len(blob), os.path.basename(path)
    sha = hashlib.sha256(blob).hexdigest()
    est_total = max(1, math.ceil(size / chunk_size))

    prot = f"Hamming {'on' if use_fec else 'off'} | check {check}"
    log(f"sending '{name}' ({size} B, ~{est_total} chunks of {chunk_size} B) to {host}:{port} [{prot}]", "c")

    telemetry.emit("client", "start", file=name, size=size, chunks=est_total, chunk_size=chunk_size,
                   fec=use_fec, sha256=sha, check=check)

    try:
        sock = socket.create_connection((host, port), timeout=timeout)
    except OSError as e:
        raise TransferError(f"cannot connect to {host}:{port}: {e}") from e
    sock.settimeout(timeout)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    frame_kw = dict(use_fec=use_fec, check=check)
    st = {"retransmits": 0, "nacks": 0, "timeouts": 0, "rtts_ms": [], "bytes_on_wire": 0, "chunks": 0}

    def exchange(frame_bytes, seq, label, attempt, info=None):
        t0 = time.perf_counter()
        sock.sendall(frame_bytes)
        st["bytes_on_wire"] += len(frame_bytes)
        if label == "DATA":
            _, _, _, flags, _, wire_len, check_val = struct.unpack(P.HEADER_FMT, frame_bytes[:P.HEADER_SIZE])
            telemetry.emit("client", "send", seq=seq, attempt=attempt, flags=flags, wire_len=wire_len,
                           check_value=check_val, **(info or {}))
        try:
            reply = P.read_frame(sock)
            while reply.type in (P.ACK, P.NACK) and label == "DATA" and reply.seq < seq:
                reply = P.read_frame(sock)
        except socket.timeout:
            st["timeouts"] += 1
            st["retransmits"] += 1
            log(f"{label} {seq} timeout (attempt {attempt}) -> retransmit", "y")
            telemetry.emit("client", "timeout", seq=seq, attempt=attempt)
            return "timeout", None
        rtt = (time.perf_counter() - t0) * 1000
        if reply.type == P.ERR:
            raise TransferError(f"server error: {reply.payload.decode(errors='replace')}")
        if reply.type == P.ACK and reply.seq == seq:
            fixed = int(reply.payload) if reply.payload.isdigit() else 0
            if label == "DATA":
                telemetry.emit("client", "ack", seq=seq, attempt=attempt, rtt_ms=round(rtt, 3), fixed=fixed)
            return "ok", rtt
        reason = reply.payload.decode(errors="replace") if reply.type == P.NACK else "bad ack"
        st["nacks"] += 1
        st["retransmits"] += 1
        log(f"{label} {seq} NACK ({reason}) -> retransmit #{attempt}", "r")
        telemetry.emit("client", "nack", seq=seq, attempt=attempt, reason=reason)
        return "nack", rtt

    t_start = time.perf_counter()
    try:
        meta = json.dumps({"name": name, "size": size, "chunks": est_total,
                           "chunk_size": chunk_size, "sha256": sha, "check": check}).encode()
        for attempt in range(1, max_retries + 1):
            status, _ = exchange(P.build_frame(P.META, 0, meta, **frame_kw), 0, "META", attempt)
            if status == "ok":
                break
        else:
            raise TransferError(f"META failed after {max_retries} attempts")

        offset, seq = 0, 0
        while True:
            chunk = blob[offset:offset + chunk_size]
            for attempt in range(1, max_retries + 1):
                status, rtt = exchange(
                    P.build_frame(P.DATA, seq, chunk, **frame_kw), seq, "DATA", attempt,
                    {"offset": offset, "length": len(chunk), "head": chunk[:4].hex(), "check": check})
                if status == "ok":
                    break
            else:
                raise TransferError(f"DATA {seq} failed after {max_retries} attempts")

            st["rtts_ms"].append(round(rtt, 3))
            offset += len(chunk)
            seq += 1
            st["chunks"] = seq
            elapsed = time.perf_counter() - t_start
            remaining = math.ceil((size - offset) / chunk_size) if offset < size else 0
            telemetry.emit("client", "progress", seq=seq - 1, done=offset, total=size,
                           est_total=seq + remaining,
                           throughput_kbps=round(offset / 1024 / max(elapsed, 1e-6), 1))
            if seq % max(1, est_total // 10) == 0 or offset >= size:
                log(f"chunk {seq}/{seq + remaining} ACK  rtt={rtt:.2f} ms", "g")
            if offset >= size:
                break
            if delay_ms:
                time.sleep(delay_ms / 1000)

        sock.sendall(P.build_frame(P.DONE, seq, b"", **frame_kw))
        reply = P.read_frame(sock)
        result = json.loads(P.open_frame(reply)[0]) if reply.type == P.RESULT else {}
    except (ConnectionError, OSError) as e:
        raise TransferError(f"connection lost: {e}") from e
    finally:
        sock.close()

    elapsed = time.perf_counter() - t_start
    rtts = st["rtts_ms"]
    stats = {
        "file": name, "size": size, "chunks": st["chunks"], "chunk_size": chunk_size,
        "fec": use_fec, "check": check,
        "retransmits": st["retransmits"], "nacks": st["nacks"], "timeouts": st["timeouts"],
        "rtts_ms": rtts, "bytes_on_wire": st["bytes_on_wire"],
        "elapsed_s": round(elapsed, 4),
        "throughput_kbps": round(size / 1024 / max(elapsed, 1e-6), 2),
        "avg_rtt_ms": round(sum(rtts) / len(rtts), 3) if rtts else 0,
        "verified": bool(result.get("match")),
        "verdict": "verified" if result.get("match") else "rejected",
        "server_stats": result.get("stats", {}),
        "result": result,
    }
    telemetry.emit("client", "done", **{k: v for k, v in stats.items() if k != "rtts_ms"})
    if stats["verified"]:
        log(f"VERIFIED  SHA-256 match | {elapsed:.3f}s | {stats['throughput_kbps']} KB/s | "
            f"retransmits {stats['retransmits']}", "g")
    else:
        log(f"REJECTED  SHA-256 mismatch", "r")
    return stats


def main():
    ap = argparse.ArgumentParser(description="SecureTransfer client")
    ap.add_argument("file")
    ap.add_argument("--host", default=config.HOST)
    ap.add_argument("--port", type=int, default=config.PROXY_PORT,
                    help="8000 = via proxy/channel (default), 9000 = direct to server")
    ap.add_argument("--chunk", type=int, default=config.DEFAULT_CHUNK_SIZE)
    ap.add_argument("--fec", action="store_true", help="Hamming(7,4) forward error correction")
    ap.add_argument("--check", choices=P.CHECK_MODES, default="checksum16",
                    help="per-chunk error detection: 16-bit checksum (default) or CRC32")
    ap.add_argument("--delay", type=int, default=0, help="ms pause between chunks (for demos)")
    a = ap.parse_args()
    try:
        s = send_file(a.file, a.host, a.port, chunk_size=a.chunk, use_fec=a.fec,
                      delay_ms=a.delay, check=a.check)
    except TransferError as e:
        print(f"{C['r']}[CLIENT] transfer failed: {e}{C['x']}")
        raise SystemExit(1)
    print(json.dumps({k: v for k, v in s.items() if k != "rtts_ms"}, indent=2))
    if not s["verified"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
