"""
SecureTransfer SERVER -- receives a file over TCP, verifies every chunk
(Hamming FEC -> CRC32/checksum), replies ACK/NACK, then checks the SHA-256 of the whole file.

A file only ever appears in received/ after its SHA-256 matched. If the hash does not match
the file is saved as received/<name>.rejected.

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

C = {"g": "\033[92m", "r": "\033[91m", "y": "\033[93m", "b": "\033[94m",
     "c": "\033[96m", "x": "\033[0m", "d": "\033[2m"}
STATUS_COLOR = {P.OK: "g", P.CORRECTED: "b", P.CRC_FAIL: "r", P.CSUM_FAIL: "r"}


def log(msg, color="x", quiet=False):
    if not quiet:
        print(f"{C['d']}{time.strftime('%H:%M:%S')}{C['x']} {C[color]}[SERVER]{C['x']} {msg}", flush=True)


class FileServer:
    def __init__(self, host="0.0.0.0", port=config.SERVER_PORT, out_dir=config.RECEIVED_DIR,
                 quiet=False):
        self.host, self.port, self.out_dir, self.quiet = host, port, out_dir, quiet
        self.staging_dir = os.path.join(out_dir, ".incoming")
        self._sock = None
        self._running = False
        self._ids = iter(range(1, 1 << 30))
        for d in (out_dir, self.staging_dir):
            os.makedirs(d, exist_ok=True)

    def start(self, background=False):
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind((self.host, self.port))
        self.port = self._sock.getsockname()[1]
        self._sock.listen(8)
        self._running = True
        log(f"listening on {self.host}:{self.port}  (verified files -> {self.out_dir})", "c", self.quiet)
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

    def _reply(self, conn, ftype, seq, data=b""):
        conn.sendall(P.build_frame(ftype, seq, data))

    def _handle(self, conn, addr):
        log(f"connection from {addr[0]}:{addr[1]}", "c", self.quiet)
        meta, fh, staged, name, expected, received_bytes = None, None, None, None, 0, 0
        stats = {}
        chunk_log = []

        def reset_stats():
            return {"ok": 0, "corrected": 0, "crc_fail": 0, "checksum_fail": 0, "bits_fixed": 0}

        try:
            while True:
                frame = P.read_frame(conn)
                data, status, fixed = P.open_frame(frame)

                if frame.type == P.META:
                    if status in P.BAD_STATUSES:
                        self._reply(conn, P.NACK, 0, status.encode())
                        continue
                    if fh and not fh.closed:
                        fh.close()
                    meta = json.loads(data)
                    name = os.path.basename(meta["name"]) or "received.bin"
                    staged = os.path.join(self.staging_dir, f"{name}.{next(self._ids)}.part")
                    fh = open(staged, "wb")
                    expected, received_bytes, stats = 0, 0, reset_stats()
                    chunk_log = []
                    log(f"receiving '{name}' ({meta['size']} B, ~{meta['chunks']} chunks, "
                        f"FEC={'on' if frame.flags & P.FLAG_FEC else 'off'}, "
                        f"check={frame.check_name})", "c", self.quiet)
                    telemetry.emit("server", "meta", name=name, size=meta["size"], chunks=meta["chunks"])
                    self._reply(conn, P.ACK, 0)

                elif frame.type == P.DATA:
                    if meta is None:
                        self._reply(conn, P.ERR, frame.seq, b"no META received")
                        continue
                    seq = frame.seq

                    sent_check = frame.crc
                    computed_check = P.check_value(
                        P.hamming_decode(frame.payload)[0] if frame.flags & P.FLAG_FEC else frame.payload,
                        frame.flags if frame.version >= 2 else frame.flags & ~P.FLAG_CSUM16
                    )

                    if status in P.BAD_STATUSES:
                        stats[status] += 1
                        log(f"chunk {seq:>4}  {status.upper():<13} -> NACK", STATUS_COLOR[status], self.quiet)
                        telemetry.emit("server", "chunk", seq=seq, status=status, fixed=fixed,
                                       check=frame.check_name, length=len(frame.payload),
                                       sent_check=sent_check, computed_check=computed_check)
                        self._reply(conn, P.NACK, seq, status.encode())
                        continue

                    fixes = P.hamming_fix_details(frame.payload) if fixed else []
                    if seq == expected:
                        fh.write(data)
                        expected += 1
                        received_bytes += len(data)
                        stats[status] += 1
                        stats["bits_fixed"] += fixed
                        extra = f"  (Hamming fixed {fixed} bit{'s' if fixed != 1 else ''})" if fixed else ""
                        log(f"chunk {seq:>4}  {status.upper():<13} -> ACK{extra}",
                            STATUS_COLOR[status], self.quiet)

                        chunk_entry = {
                            "seq": seq, "status": status, "size": len(data),
                            "sent_check": f"{sent_check:#010x}" if not (frame.flags & P.FLAG_CSUM16) else f"{sent_check:#06x}",
                            "computed_check": f"{computed_check:#010x}" if not (frame.flags & P.FLAG_CSUM16) else f"{computed_check:#06x}",
                            "fixed": fixed, "fixes": fixes,
                        }
                        chunk_log.append(chunk_entry)

                        telemetry.emit("server", "chunk", seq=seq, status=status, fixed=fixed,
                                       fixes=fixes, check=frame.check_name, length=len(data),
                                       sent_check=sent_check, computed_check=computed_check)
                    self._reply(conn, P.ACK, seq, str(fixed).encode() if fixed else b"")

                elif frame.type == P.DONE:
                    fh.close()
                    got = P.sha256_file(staged)
                    match = got == meta["sha256"]
                    result = {"match": match, "expected": meta["sha256"], "got": got, "stats": stats,
                              "chunks_received": expected, "bytes_received": received_bytes,
                              "chunk_log": chunk_log}
                    if match:
                        final = os.path.join(self.out_dir, name)
                        os.replace(staged, final)
                        result["path"] = final
                        log(f"DONE  SHA-256 match  {got[:16]}...  -> {final}", "g", self.quiet)
                    else:
                        rejected = os.path.join(self.out_dir, f"{name}.rejected")
                        os.replace(staged, rejected)
                        result["path"] = rejected
                        result["rejected"] = True
                        log(f"DONE  SHA-256 MISMATCH  expected {meta['sha256'][:16]}... got {got[:16]}...",
                            "r", self.quiet)
                    telemetry.emit("server", "result", **result)
                    self._reply(conn, P.RESULT, 0, json.dumps(result).encode())
                    meta, fh, staged = None, None, None
        except (ConnectionError, OSError) as e:
            log(f"connection {addr[0]}:{addr[1]} closed ({e})", "y", self.quiet)
            if fh and not fh.closed:
                fh.close()
                if staged and os.path.exists(staged):
                    try:
                        os.remove(staged)
                    except OSError:
                        pass
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
