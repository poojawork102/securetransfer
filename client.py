"""
SecureTransfer CLIENT — splits a file into chunks and sends them with stop-and-wait ARQ:
every DATA frame waits for ACK; on NACK or timeout the chunk is retransmitted.

With --auto the client runs a closed loop (Auto Defense):
    monitor  (sliding window of recent transmissions)
 -> decide   (adaptive.py rules table)
 -> act      (Hamming on/off, smaller chunks, intrusion alert, give up)
 -> verify   (whole-file SHA-256 from the server; if it fails the file is quarantined and re-sent with HMAC)

Run:  python client.py sample_files/sample.txt [--auto] [--hmac] [--fec] [--check crc32|checksum16]
                                               [--chunk 1024] [--port 8000]
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

import adaptive
import config
import protocol as P
import telemetry

C = {"g": "\033[92m", "r": "\033[91m", "y": "\033[93m", "b": "\033[94m", "m": "\033[95m",
     "c": "\033[96m", "x": "\033[0m", "d": "\033[2m"}
ACTION_COLOR = {"fec_on": "b", "fec_off": "b", "halve_chunk": "y", "intrusion_alert": "m",
                "give_up": "r", "retry_with_hmac": "m"}


class TransferError(Exception):
    """Unrecoverable failure. `.stats` carries what we know (decisions taken, attempts)."""

    def __init__(self, msg, stats=None):
        super().__init__(msg)
        self.stats = stats or {}


def _make_log(quiet):
    def log(msg, color="x"):
        if not quiet:
            print(f"{C['d']}{time.strftime('%H:%M:%S')}{C['x']} {C[color]}[CLIENT]{C['x']} {msg}", flush=True)
    return log


def _protection_text(s, check):
    return f"HMAC {'on' if s.hmac else 'off'} | Hamming {'on' if s.fec else 'off'} | check {check}"


# ---------------------------------------------------------------------------
# One complete attempt to send the file (connect -> META -> DATA... -> DONE -> RESULT)
# ---------------------------------------------------------------------------
def _run_attempt(*, blob, name, sha, host, port, settings, check, key, delay_ms, max_retries, timeout,
                 auto, timeline, attempt_no, log):
    size = len(blob)
    monitor = adaptive.Monitor(settings, adaptive.Config(give_up_after=max_retries)) if auto else None
    live = (lambda: monitor.settings) if auto else (lambda: settings)
    est_total = max(1, math.ceil(size / settings.chunk_size))
    st = {"retransmits": 0, "nacks": 0, "timeouts": 0, "rtts_ms": [], "bytes_on_wire": 0, "chunks": 0}

    telemetry.emit("client", "start", file=name, size=size, chunks=est_total, chunk_size=settings.chunk_size,
                   hmac=settings.hmac, fec=settings.fec, sha256=sha, auto=auto, check=check, attempt=attempt_no)
    log(f"{'attempt %d: ' % attempt_no if attempt_no > 1 else ''}sending '{name}' ({size} B, ~{est_total} chunks "
        f"of {settings.chunk_size} B) to {host}:{port} [{_protection_text(settings, check)}"
        f"{' | AUTO DEFENSE' if auto else ''}]", "c")

    try:
        sock = socket.create_connection((host, port), timeout=timeout)
    except OSError as e:
        raise TransferError(f"cannot connect to {host}:{port}: {e}") from e
    sock.settimeout(timeout)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def frame_kw():
        s = live()
        return dict(use_hmac=s.hmac, use_fec=s.fec, key=key, check=check)

    def exchange(frame_bytes, seq, label, attempt, info=None):
        """Send one frame, wait for the reply. Returns (adaptive status, rtt_ms, reason)."""
        t0 = time.perf_counter()
        sock.sendall(frame_bytes)
        st["bytes_on_wire"] += len(frame_bytes)
        if label == "DATA":
            _, _, _, flags, _, wire_len, check_val = struct.unpack(P.HEADER_FMT, frame_bytes[:P.HEADER_SIZE])
            telemetry.emit("client", "send", seq=seq, attempt=attempt, flags=flags, wire_len=wire_len,
                           check_value=check_val, **(info or {}))
        try:
            reply = P.read_frame(sock)
            # a late ACK for an earlier chunk (after a timeout-retransmit) — ignore and keep waiting
            while reply.type in (P.ACK, P.NACK) and label == "DATA" and reply.seq < seq:
                reply = P.read_frame(sock)
        except socket.timeout:
            st["timeouts"] += 1
            st["retransmits"] += 1
            log(f"{label} {seq} timeout (attempt {attempt}) -> retransmit", "y")
            telemetry.emit("client", "timeout", seq=seq, attempt=attempt)
            return adaptive.TIMEOUT, None, "timeout"
        rtt = (time.perf_counter() - t0) * 1000
        _, rstatus, _ = P.open_frame(reply, key)
        if reply.type == P.ERR:
            raise TransferError(f"server error: {reply.payload.decode(errors='replace')}")
        if reply.type == P.ACK and reply.seq == seq and rstatus in (P.OK, P.CORRECTED):
            fixed = int(reply.payload) if reply.payload.isdigit() else 0
            status = adaptive.CORRECTED if fixed else adaptive.OK
            if label == "DATA":
                telemetry.emit("client", "ack", seq=seq, attempt=attempt, rtt_ms=round(rtt, 3), fixed=fixed)
            return status, rtt, ""
        reason = reply.payload.decode(errors="replace") if reply.type == P.NACK else "bad ack"
        st["nacks"] += 1
        st["retransmits"] += 1
        log(f"{label} {seq} NACK ({reason}) -> retransmit #{attempt}", "m" if reason == "hmac_fail" else "r")
        telemetry.emit("client", "nack", seq=seq, attempt=attempt, reason=reason)
        return (adaptive.HMAC_FAIL if reason == "hmac_fail" else adaptive.CHECK_FAIL), rtt, reason

    def act(d, seq):
        """The 'act' step: record the decision, tell the user, apply it (already applied by Monitor)."""
        timeline.append({"t": round(time.perf_counter() - t_start, 3), "attempt": attempt_no, "seq": seq,
                         "action": d.action, "reason": d.reason, "metrics": d.metrics,
                         "settings": {"fec": d.settings.fec, "hmac": d.settings.hmac,
                                      "chunk_size": d.settings.chunk_size}})
        telemetry.emit("client", "adapt", action=d.action, reason=d.reason, metrics=d.metrics, seq=seq,
                       fec=d.settings.fec, hmac=d.settings.hmac, chunk_size=d.settings.chunk_size)
        log(f"AUTO DEFENSE ▶ {d.reason}", ACTION_COLOR.get(d.action, "y"))
        if d.action == "give_up":
            raise TransferError(d.reason)

    t_start = time.perf_counter()
    try:
        # ---- META (not monitored: it is one tiny frame) ----
        meta = json.dumps({"name": name, "size": size, "chunks": est_total, "chunk_size": settings.chunk_size,
                           "sha256": sha, "check": check}).encode()
        for attempt in range(1, max_retries + 1):
            status, _, _ = exchange(P.build_frame(P.META, 0, meta, **frame_kw()), 0, "META", attempt)
            if status in (adaptive.OK, adaptive.CORRECTED):
                break
        else:
            raise TransferError(f"META failed after {max_retries} attempts")

        # ---- DATA: offset-based so the chunk size may change between chunks ----
        offset, seq = 0, 0
        while True:
            chunk = blob[offset:offset + live().chunk_size]        # fixed for all retries of this seq
            for attempt in range(1, max_retries + 1):
                status, rtt, _ = exchange(P.build_frame(P.DATA, seq, chunk, **frame_kw()), seq, "DATA", attempt,
                                          {"offset": offset, "length": len(chunk), "head": chunk[:4].hex(),
                                           "check": check})
                if monitor:
                    d = monitor.record(seq, status)
                    if d:
                        act(d, seq)
                if status in (adaptive.OK, adaptive.CORRECTED):
                    break
            else:
                raise TransferError(f"DATA {seq} failed after {max_retries} attempts")

            st["rtts_ms"].append(round(rtt, 3))
            offset += len(chunk)
            seq += 1
            st["chunks"] = seq
            elapsed = time.perf_counter() - t_start
            remaining = math.ceil((size - offset) / live().chunk_size) if offset < size else 0
            telemetry.emit("client", "progress", seq=seq - 1, done=offset, total=size, est_total=seq + remaining,
                           throughput_kbps=round(offset / 1024 / max(elapsed, 1e-6), 1))
            if seq % max(1, est_total // 10) == 0 or offset >= size:
                log(f"chunk {seq}/{seq + remaining} ACK  rtt={rtt:.2f} ms", "g")
            if offset >= size:
                break
            if delay_ms:
                time.sleep(delay_ms / 1000)

        sock.sendall(P.build_frame(P.DONE, seq, b"", **frame_kw()))
        reply = P.read_frame(sock)
        result = json.loads(P.open_frame(reply, key)[0]) if reply.type == P.RESULT else {}
    except (ConnectionError, OSError) as e:
        raise TransferError(f"connection lost: {e}") from e
    finally:
        sock.close()

    final = live()
    return {"verified": bool(result.get("match")), "result": result, "server_stats": result.get("stats", {}),
            "quarantine_path": result.get("path") if result.get("quarantined") else None,
            "elapsed_s": time.perf_counter() - t_start, "final": final,
            "forged_seqs": list(monitor.forged_seqs) if monitor else [], **st}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def send_file(path, host=config.HOST, port=config.PROXY_PORT, *, chunk_size=config.DEFAULT_CHUNK_SIZE,
              use_hmac=False, use_fec=False, key=config.SHARED_KEY, delay_ms=0,
              max_retries=config.MAX_RETRIES, timeout=config.ACK_TIMEOUT_S, quiet=False,
              check="checksum16", auto=False):
    """Send one file. Returns a stats dict. Raises TransferError on unrecoverable failure.

    The transfer ends in exactly one verdict: "verified" (SHA-256 matched, file is in received/) or
    "rejected" (file quarantined on the server)."""
    log = _make_log(quiet)
    with open(path, "rb") as f:
        blob = f.read()
    size, name = len(blob), os.path.basename(path)
    sha = hashlib.sha256(blob).hexdigest()
    settings = adaptive.Settings(fec=use_fec, hmac=use_hmac, chunk_size=chunk_size)
    initial = settings
    timeline, attempts = [], []
    t_all = time.perf_counter()

    def failure_stats(extra=None):
        return {"decisions": timeline, "attempts": attempts, "verdict": "failed", "file": name, "size": size,
                "final_protection": {"fec": settings.fec, "hmac": settings.hmac, "check": check,
                                     "chunk_size": settings.chunk_size}, **(extra or {})}

    for attempt_no in (1, 2):
        try:
            res = _run_attempt(blob=blob, name=name, sha=sha, host=host, port=port, settings=settings,
                               check=check, key=key, delay_ms=delay_ms, max_retries=max_retries,
                               timeout=timeout, auto=auto, timeline=timeline, attempt_no=attempt_no, log=log)
        except TransferError as e:
            telemetry.emit("client", "error", msg=str(e), decisions=timeline, attempts=len(attempts) + 1,
                           reason="gave_up" if "Gave up" in str(e) or "failed after" in str(e) else "error")
            e.stats = failure_stats()
            raise
        settings = res["final"]
        attempts.append({"n": attempt_no, "verified": res["verified"], "hmac": settings.hmac, "fec": settings.fec,
                         "chunk_size": settings.chunk_size, "retransmits": res["retransmits"],
                         "elapsed_s": round(res["elapsed_s"], 3), "quarantine_path": res["quarantine_path"],
                         "server_stats": res["server_stats"]})
        if res["verified"]:
            break
        log(f"SHA-256 MISMATCH ✘ file rejected and quarantined on the server → {res['quarantine_path']}", "r")
        d = adaptive.decide_after_verify(False, settings, attempt_no) if auto else None
        if d is None:
            break
        timeline.append({"t": round(time.perf_counter() - t_all, 3), "attempt": attempt_no, "seq": None,
                         "action": d.action, "reason": d.reason, "metrics": None,
                         "settings": {"fec": d.settings.fec, "hmac": d.settings.hmac,
                                      "chunk_size": d.settings.chunk_size}})
        telemetry.emit("client", "adapt", action=d.action, reason=d.reason, metrics=None, seq=None,
                       fec=d.settings.fec, hmac=d.settings.hmac, chunk_size=d.settings.chunk_size,
                       quarantine_path=res["quarantine_path"])
        log(f"AUTO DEFENSE ▶ {d.reason}", ACTION_COLOR[d.action])
        settings = d.settings

    elapsed = time.perf_counter() - t_all
    rtts = res["rtts_ms"]
    retransmits = res["retransmits"] + sum(a["retransmits"] for a in attempts[:-1])
    on_wire = res["bytes_on_wire"]
    stats = {
        "file": name, "size": size, "chunks": res["chunks"], "chunk_size": initial.chunk_size,
        "hmac": settings.hmac, "fec": settings.fec, "check": check, "auto": auto,
        "retransmits": retransmits, "nacks": res["nacks"], "timeouts": res["timeouts"],
        "rtts_ms": rtts, "bytes_on_wire": on_wire,
        "elapsed_s": round(elapsed, 4),
        "throughput_kbps": round(size / 1024 / max(elapsed, 1e-6), 2),
        "avg_rtt_ms": round(sum(rtts) / len(rtts), 3) if rtts else 0,
        "jitter_ms": round(sum(abs(rtts[i] - rtts[i - 1]) for i in range(1, len(rtts))) / max(1, len(rtts) - 1), 3),
        "overhead_pct": round((on_wire - size) / max(size, 1) * 100, 2),
        "verified": res["verified"],
        "verdict": "verified" if res["verified"] else "rejected",
        "server_stats": res["server_stats"],
        "decisions": timeline, "attempts": attempts,
        "final_protection": {"fec": settings.fec, "hmac": settings.hmac, "check": check,
                             "chunk_size": settings.chunk_size},
        "quarantine_path": next((a["quarantine_path"] for a in reversed(attempts) if a["quarantine_path"]), None),
        "forged_seqs": res["forged_seqs"],
    }
    telemetry.emit("client", "done", **{k: v for k, v in stats.items() if k != "rtts_ms"})
    if stats["verified"]:
        log(f"VERIFIED ✔ SHA-256 match | {elapsed:.3f}s | {stats['throughput_kbps']} KB/s | "
            f"retransmits {stats['retransmits']}"
            + (f" | {len(attempts)} attempts" if len(attempts) > 1 else ""), "g")
    else:
        log("REJECTED ✘ SHA-256 mismatch — every chunk passed its check but the file is wrong; "
            f"quarantined: {stats['quarantine_path']}", "r")
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
    ap.add_argument("--check", choices=P.CHECK_MODES, default="checksum16",
                    help="per-chunk error detection: 16-bit checksum (default) or CRC32")
    ap.add_argument("--auto", action="store_true",
                    help="Auto Defense: adapt FEC / chunk size, raise intrusion alerts, quarantine + retry with HMAC")
    ap.add_argument("--delay", type=int, default=0, help="ms pause between chunks (for demos)")
    a = ap.parse_args()
    try:
        s = send_file(a.file, a.host, a.port, chunk_size=a.chunk, use_hmac=a.hmac, use_fec=a.fec,
                      delay_ms=a.delay, check=a.check, auto=a.auto)
    except TransferError as e:
        print(f"{C['r']}[CLIENT] transfer failed: {e}{C['x']}")
        raise SystemExit(1)
    print(json.dumps({k: v for k, v in s.items() if k != "rtts_ms"}, indent=2))
    if not s["verified"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
