"""
SecureTransfer SERVER — receives a file over TCP, verifies every chunk
(Hamming FEC -> CRC32/checksum -> HMAC), replies ACK/NACK, then checks the SHA-256 of the whole file.

A file only ever appears in received/ after its SHA-256 matched. While it is being received it lives in
received/.incoming/; if the hash does not match (or the connection dies half way) it is moved to
quarantine/<name>.<timestamp>.rejected together with a JSON sidecar that says why.

Run:  python server.py [--port 9000]
"""
import argparse
import json
import os
import shutil
import socket
import threading
import time

import config
import protocol as P
import telemetry

C = {"g": "\033[92m", "r": "\033[91m", "y": "\033[93m", "b": "\033[94m", "m": "\033[95m",
     "c": "\033[96m", "x": "\033[0m", "d": "\033[2m"}
STATUS_COLOR = {P.OK: "g", P.CORRECTED: "b", P.CRC_FAIL: "r", P.CSUM_FAIL: "r", P.HMAC_FAIL: "m"}


def log(msg, color="x", quiet=False):
    if not quiet:
        print(f"{C['d']}{time.strftime('%H:%M:%S')}{C['x']} {C[color]}[SERVER]{C['x']} {msg}", flush=True)


class FileServer:
    def __init__(self, host="0.0.0.0", port=config.SERVER_PORT, out_dir=config.RECEIVED_DIR,
                 key=config.SHARED_KEY, quiet=False, quarantine_dir=None):
        self.host, self.port, self.out_dir, self.key, self.quiet = host, port, out_dir, key, quiet
        self.quarantine_dir = quarantine_dir or out_dir.rstrip("/\\") + "_quarantine"
        self.staging_dir = os.path.join(out_dir, ".incoming")
        self._sock = None
        self._running = False
        self._ids = iter(range(1, 1 << 30))
        for d in (out_dir, self.quarantine_dir, self.staging_dir):
            os.makedirs(d, exist_ok=True)

    # -- lifecycle -----------------------------------------------------------
    def start(self, background=False):
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind((self.host, self.port))
        self.port = self._sock.getsockname()[1]
        self._sock.listen(8)
        self._running = True
        log(f"listening on {self.host}:{self.port}  (verified files -> {self.out_dir}, "
            f"rejected -> {self.quarantine_dir})", "c", self.quiet)
        threading.Thread(target=self._heartbeat, daemon=True).start()
        if background:
            threading.Thread(target=self._accept_loop, daemon=True).start()
        else:
            self._accept_loop()
        return self

    def stop(self):
        self._running = False
        try:
            self._sock.close()
        except OSError:
            pass

    def _heartbeat(self):
        while self._running:
            telemetry.emit("server", "heartbeat", port=self.port)
            time.sleep(1.5)

    def _accept_loop(self):
        while self._running:
            try:
                conn, addr = self._sock.accept()
            except OSError:
                break
            threading.Thread(target=self._handle, args=(conn, addr), daemon=True).start()

    # -- quarantine ----------------------------------------------------------
    def _quarantine(self, staged, name, reason, detail):
        """Move a staged file into quarantine/ and write the JSON sidecar. Returns the new path."""
        stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}"
        dest = os.path.join(self.quarantine_dir, f"{name}.{stamp}.rejected")
        shutil.move(staged, dest)
        info = {"file": name, "reason": reason, "time": time.strftime("%Y-%m-%d %H:%M:%S"), **detail}
        with open(dest + ".json", "w", encoding="utf-8") as fh:
            json.dump(info, fh, indent=2)
        log(f"QUARANTINED {name} ({reason}) -> {dest}", "m", self.quiet)
        telemetry.emit("server", "quarantine", name=name, reason=reason, path=dest, **detail)
        return dest

    # -- per-connection protocol ----------------------------------------------
    def _reply(self, conn, ftype, seq, data=b"", use_hmac=False):
        conn.sendall(P.build_frame(ftype, seq, data, use_hmac=use_hmac, key=self.key))

    def _handle(self, conn, addr):
        log(f"connection from {addr[0]}:{addr[1]}", "c", self.quiet)
        meta, fh, staged, name, expected, received_bytes = None, None, None, None, 0, 0
        stats = {}

        def reset_stats():
            return {"ok": 0, "corrected": 0, "crc_fail": 0, "checksum_fail": 0, "hmac_fail": 0, "bits_fixed": 0}

        try:
            while True:
                frame = P.read_frame(conn)
                data, status, fixed = P.open_frame(frame, self.key)
                use_hmac = bool(frame.flags & P.FLAG_HMAC)

                if frame.type == P.META:
                    if status in P.BAD_STATUSES:
                        self._reply(conn, P.NACK, 0, status.encode(), use_hmac)
                        continue
                    if fh and not fh.closed:                       # a new META abandons the previous file
                        fh.close()
                        self._quarantine(staged, name, "new transfer started before DONE",
                                         {"chunks_received": expected, "bytes_received": received_bytes})
                    meta = json.loads(data)
                    name = os.path.basename(meta["name"]) or "received.bin"
                    staged = os.path.join(self.staging_dir, f"{name}.{next(self._ids)}.part")
                    fh = open(staged, "wb")
                    expected, received_bytes, stats = 0, 0, reset_stats()
                    log(f"receiving '{name}' ({meta['size']} B, ~{meta['chunks']} chunks, "
                        f"HMAC={'on' if use_hmac else 'off'}, FEC={'on' if frame.flags & P.FLAG_FEC else 'off'}, "
                        f"check={frame.check_name})", "c", self.quiet)
                    telemetry.emit("server", "meta", name=name, size=meta["size"], chunks=meta["chunks"])
                    self._reply(conn, P.ACK, 0, b"", use_hmac)

                elif frame.type == P.DATA:
                    if meta is None:
                        self._reply(conn, P.ERR, frame.seq, b"no META received")
                        continue
                    seq = frame.seq
                    if status in P.BAD_STATUSES:
                        stats[status] += 1
                        log(f"chunk {seq:>4}  {status.upper():<13} -> NACK"
                            + ("   (data was modified but CRC matched: forged!)" if status == P.HMAC_FAIL else ""),
                            STATUS_COLOR[status], self.quiet)
                        telemetry.emit("server", "chunk", seq=seq, status=status, fixed=fixed,
                                       check=frame.check_name, length=len(frame.payload))
                        self._reply(conn, P.NACK, seq, status.encode(), use_hmac)
                        continue
                    fixes = P.hamming_fix_details(frame.payload) if fixed else []
                    if seq == expected:
                        fh.write(data)
                        expected += 1
                        received_bytes += len(data)
                        stats[status] += 1
                        stats["bits_fixed"] += fixed
                        extra = f"  (Hamming fixed {fixed} bit{'s' if fixed != 1 else ''})" if fixed else ""
                        log(f"chunk {seq:>4}  {status.upper():<13} -> ACK{extra}", STATUS_COLOR[status], self.quiet)
                        telemetry.emit("server", "chunk", seq=seq, status=status, fixed=fixed, fixes=fixes,
                                       check=frame.check_name, length=len(data))
                    # seq < expected -> duplicate (our ACK was lost/late); just ACK again
                    self._reply(conn, P.ACK, seq, str(fixed).encode() if fixed else b"", use_hmac)

                elif frame.type == P.DONE:
                    fh.close()
                    got = P.sha256_file(staged)
                    match = got == meta["sha256"]
                    result = {"match": match, "expected": meta["sha256"], "got": got, "stats": stats,
                              "quarantined": not match, "chunks_received": expected,
                              "bytes_received": received_bytes}
                    if match:
                        final = os.path.join(self.out_dir, name)
                        os.replace(staged, final)
                        result["path"] = final
                        log(f"DONE  SHA-256 match ✔  {got[:16]}…  -> {final}", "g", self.quiet)
                    else:
                        log(f"DONE  SHA-256 MISMATCH ✘  expected {meta['sha256'][:16]}… got {got[:16]}…", "r",
                            self.quiet)
                        result["reason"] = "sha256_mismatch"
                        result["path"] = self._quarantine(
                            staged, name, "sha256_mismatch",
                            {"expected_sha256": meta["sha256"], "got_sha256": got,
                             "expected_size": meta["size"], "got_size": received_bytes,
                             "chunks_received": expected, "stats": stats})
                    telemetry.emit("server", "result", **result)
                    self._reply(conn, P.RESULT, 0, json.dumps(result).encode(), use_hmac)
                    meta, fh, staged = None, None, None
        except (ConnectionError, OSError) as e:
            log(f"connection {addr[0]}:{addr[1]} closed ({e})", "y", self.quiet)
            if fh and not fh.closed:
                fh.close()
                self._quarantine(staged, name, "connection_closed_before_done",
                                 {"chunks_received": expected, "bytes_received": received_bytes,
                                  "expected_size": meta["size"] if meta else None, "stats": stats})
                telemetry.emit("server", "aborted", received=expected)
        except P.ProtocolError as e:
            log(f"protocol error: {e}", "r", self.quiet)
        finally:
            conn.close()


def main():
    ap = argparse.ArgumentParser(description="SecureTransfer server")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=config.SERVER_PORT)
    ap.add_argument("--out", default=config.RECEIVED_DIR)
    ap.add_argument("--quarantine", default=config.QUARANTINE_DIR)
    a = ap.parse_args()
    try:
        FileServer(a.host, a.port, a.out, quarantine_dir=a.quarantine).start()
    except KeyboardInterrupt:
        log("stopped", "y")


if __name__ == "__main__":
    main()
