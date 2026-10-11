"""
SecureTransfer SERVER — receives a file over TCP, verifies every chunk
(Hamming FEC -> CRC32 -> HMAC), replies ACK/NACK, then checks the SHA-256 of the whole file.

Run:  python server.py [--port 9000]
"""
import argparse
import json
import os
import socket
import threading
import time

import config
import protocol as P
import telemetry

C = {"g": "\033[92m", "r": "\033[91m", "y": "\033[93m", "b": "\033[94m", "m": "\033[95m",
     "c": "\033[96m", "x": "\033[0m", "d": "\033[2m"}
STATUS_COLOR = {P.OK: "g", P.CORRECTED: "b", P.CRC_FAIL: "r", P.HMAC_FAIL: "m"}


def log(msg, color="x", quiet=False):
    if not quiet:
        print(f"{C['d']}{time.strftime('%H:%M:%S')}{C['x']} {C[color]}[SERVER]{C['x']} {msg}", flush=True)


class FileServer:
    def __init__(self, host="0.0.0.0", port=config.SERVER_PORT, out_dir=config.RECEIVED_DIR,
                 key=config.SHARED_KEY, quiet=False):
        self.host, self.port, self.out_dir, self.key, self.quiet = host, port, out_dir, key, quiet
        self._sock = None
        self._running = False
        os.makedirs(out_dir, exist_ok=True)

    # -- lifecycle -----------------------------------------------------------
    def start(self, background=False):
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind((self.host, self.port))
        self.port = self._sock.getsockname()[1]
        self._sock.listen(8)
        self._running = True
        log(f"listening on {self.host}:{self.port}  (saving to {self.out_dir})", "c", self.quiet)
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

    # -- per-connection protocol ----------------------------------------------
    def _reply(self, conn, ftype, seq, data=b"", use_hmac=False):
        conn.sendall(P.build_frame(ftype, seq, data, use_hmac=use_hmac, key=self.key))

    def _handle(self, conn, addr):
        log(f"connection from {addr[0]}:{addr[1]}", "c", self.quiet)
        meta, fh, path, expected = None, None, None, 0
        stats = {"ok": 0, "corrected": 0, "crc_fail": 0, "hmac_fail": 0, "bits_fixed": 0}
        try:
            while True:
                frame = P.read_frame(conn)
                data, status, fixed = P.open_frame(frame, self.key)
                use_hmac = bool(frame.flags & P.FLAG_HMAC)

                if frame.type == P.META:
                    if status in (P.CRC_FAIL, P.HMAC_FAIL):
                        self._reply(conn, P.NACK, 0, status.encode(), use_hmac)
                        continue
                    meta = json.loads(data)
                    name = os.path.basename(meta["name"]) or "received.bin"
                    path = os.path.join(self.out_dir, name)
                    fh = open(path, "wb")
                    expected = 0
                    log(f"receiving '{name}' ({meta['size']} B, {meta['chunks']} chunks, "
                        f"HMAC={'on' if use_hmac else 'off'}, FEC={'on' if frame.flags & P.FLAG_FEC else 'off'})",
                        "c", self.quiet)
                    telemetry.emit("server", "meta", name=name, size=meta["size"], chunks=meta["chunks"])
                    self._reply(conn, P.ACK, 0, b"", use_hmac)

                elif frame.type == P.DATA:
                    if meta is None:
                        self._reply(conn, P.ERR, frame.seq, b"no META received")
                        continue
                    seq = frame.seq
                    if status in (P.CRC_FAIL, P.HMAC_FAIL):
                        stats[status] += 1
                        log(f"chunk {seq:>4}  {status.upper():<9} -> NACK"
                            + ("   (data was modified but CRC matched: forged!)" if status == P.HMAC_FAIL else ""),
                            STATUS_COLOR[status], self.quiet)
                        telemetry.emit("server", "chunk", seq=seq, status=status, fixed=fixed)
                        self._reply(conn, P.NACK, seq, status.encode(), use_hmac)
                        continue
                    if seq == expected:
                        fh.write(data)
                        expected += 1
                        stats[status] += 1
                        stats["bits_fixed"] += fixed
                        extra = f"  (Hamming fixed {fixed} bit{'s' if fixed != 1 else ''})" if fixed else ""
                        log(f"chunk {seq:>4}  {status.upper():<9} -> ACK{extra}", STATUS_COLOR[status], self.quiet)
                        telemetry.emit("server", "chunk", seq=seq, status=status, fixed=fixed)
                    # seq < expected -> duplicate (our ACK was lost/late); just ACK again
                    self._reply(conn, P.ACK, seq, b"", use_hmac)

                elif frame.type == P.DONE:
                    fh.close()
                    got = P.sha256_file(path)
                    match = got == meta["sha256"]
                    result = {"match": match, "expected": meta["sha256"], "got": got,
                              "path": path, "stats": stats}
                    if match:
                        log(f"DONE  SHA-256 match ✔  {got[:16]}…  -> {path}", "g", self.quiet)
                    else:
                        log(f"DONE  SHA-256 MISMATCH ✘  expected {meta['sha256'][:16]}… got {got[:16]}…", "r",
                            self.quiet)
                    telemetry.emit("server", "result", **result)
                    self._reply(conn, P.RESULT, 0, json.dumps(result).encode(), use_hmac)
                    meta, fh = None, None
        except (ConnectionError, OSError) as e:
            log(f"connection {addr[0]}:{addr[1]} closed ({e})", "y", self.quiet)
            if fh and not fh.closed:
                fh.close()
                log(f"partial file kept: {path} ({expected} chunks received)", "y", self.quiet)
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
    a = ap.parse_args()
    try:
        FileServer(a.host, a.port, a.out).start()
    except KeyboardInterrupt:
        log("stopped", "y")


if __name__ == "__main__":
    main()
