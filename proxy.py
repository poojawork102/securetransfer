"""
SecureTransfer PROXY — sits between client and server and plays the role of the channel.

Modes
  clean   forward everything untouched
  noise   flip random bits in DATA payloads (simulates a noisy link)            -> CRC catches it
          --pattern swap instead swaps two 16-bit words inside the chunk         -> checksum16 is
          (a reordering error)                                                      FOOLED, CRC32 catches it
  attack  man-in-the-middle: rewrite chunk content AND recompute the CRC32       -> CRC is fooled,
          (it cannot forge the HMAC because it doesn't know the shared key)         HMAC catches it
Extra knobs: per-frame latency (delay_ms) and frame loss (loss) for timeout/retransmit tests.

Run:  python proxy.py [--mode noise --rate 0.1 --bits 1 --pattern random|swap]
Live control: the dashboard sends JSON over UDP to port 5556, e.g. {"mode":"attack","rate":0.2}
"""
import argparse
import json
import random
import socket
import threading
import time

import config
import protocol as P
import telemetry

C = {"g": "\033[92m", "r": "\033[91m", "y": "\033[93m", "m": "\033[95m", "c": "\033[96m",
     "x": "\033[0m", "d": "\033[2m"}
ATTACK_MARK = b"HACKED!!"


def log(msg, color="x", quiet=False):
    if not quiet:
        print(f"{C['d']}{time.strftime('%H:%M:%S')}{C['x']} {C[color]}[PROXY ]{C['x']} {msg}", flush=True)


def flip_bits_detail(payload: bytes, n_bits: int, rng: random.Random, fec: bool):
    """Flip n random bits. Returns (new_payload, flips) where flips = [{"byte": wire offset, "bit": 0..7 (0=LSB)}].
    With FEC, all flips land in ONE 7-bit codeword when n_bits>1 (a burst) so n_bits=1 is
    correctable and n_bits>=2 is not."""
    if not payload:
        return payload, []
    buf = bytearray(payload)
    flips = []
    if fec:
        i = rng.randrange(len(buf))
        for b in rng.sample(range(7), min(n_bits, 7)):
            buf[i] ^= 1 << b
            flips.append({"byte": i, "bit": b})
    else:
        for _ in range(n_bits):
            pos = rng.randrange(len(buf) * 8)
            buf[pos // 8] ^= 1 << (pos % 8)
            flips.append({"byte": pos // 8, "bit": pos % 8})
    return bytes(buf), flips


def flip_bits(payload: bytes, n_bits: int, rng: random.Random, fec: bool) -> bytes:
    return flip_bits_detail(payload, n_bits, rng, fec)[0]


def swap_words(data: bytes, rng: random.Random):
    """Swap two different, 16-bit aligned words of the PLAINTEXT. The sum of the words is unchanged,
    so the 16-bit Internet checksum cannot see it; CRC32 can. Returns (new_data, info) or (data, None)."""
    n_words = len(data) // 2
    if n_words < 2:
        return data, None
    for _ in range(30):
        i, j = sorted(rng.sample(range(n_words), 2))
        if data[2 * i:2 * i + 2] != data[2 * j:2 * j + 2]:
            buf = bytearray(data)
            buf[2 * i:2 * i + 2], buf[2 * j:2 * j + 2] = data[2 * j:2 * j + 2], data[2 * i:2 * i + 2]
            return bytes(buf), {"byte_a": 2 * i, "byte_b": 2 * j}
    return data, None


def forge_chunk(frame: P.Frame, rng: random.Random) -> P.Frame:
    """MITM: change the plaintext, then recompute a *valid* CRC32 / checksum. HMAC bytes are left as-is."""
    fec = bool(frame.flags & P.FLAG_FEC)
    data = P.hamming_decode(frame.payload)[0] if fec else frame.payload
    if not data:
        return frame
    buf = bytearray(data)
    off = rng.randrange(max(1, len(buf) - len(ATTACK_MARK) + 1))
    mark = ATTACK_MARK[: len(buf) - off]
    buf[off:off + len(mark)] = mark
    if bytes(buf) == data:                       # chunk already contained the mark — flip a byte instead
        buf[off] ^= 0xFF
    data = bytes(buf)
    payload = P.hamming_encode(data) if fec else data
    check = P.check_value(data, frame.flags if frame.version >= 2 else frame.flags & ~P.FLAG_CSUM16)
    return P.Frame(frame.type, frame.flags, frame.seq, check, frame.mac, payload, frame.version)


class Proxy:
    def __init__(self, listen_port=config.PROXY_PORT, server_host=config.SERVER_HOST,
                 server_port=config.SERVER_PORT, control_port=config.PROXY_CONTROL_PORT,
                 mode="clean", rate=0.1, bits=1, delay_ms=0, loss=0.0, seed=None, quiet=False,
                 pattern="random"):
        self.listen_port, self.server_host, self.server_port = listen_port, server_host, server_port
        self.control_port = control_port
        self.state = {"mode": mode, "rate": rate, "bits": bits, "delay_ms": delay_ms, "loss": loss,
                      "pattern": pattern}
        self.rng = random.Random(seed)
        self.quiet = quiet
        self.counters = {"forwarded": 0, "corrupted": 0, "forged": 0, "dropped": 0}
        self._lock = threading.Lock()
        self._running = False

    # -- control ---------------------------------------------------------------
    def set_state(self, **kw):
        with self._lock:
            for k in ("mode", "rate", "bits", "delay_ms", "loss", "pattern"):
                if k in kw and kw[k] is not None:
                    self.state[k] = kw[k]
            self.state["rate"] = float(self.state["rate"])
            self.state["bits"] = int(self.state["bits"])
            self.state["delay_ms"] = float(self.state["delay_ms"])
            self.state["loss"] = float(self.state["loss"])
            self.state["pattern"] = "swap" if self.state["pattern"] == "swap" else "random"
        log(f"channel -> {self.describe()}", "m" if self.state["mode"] == "attack" else "c", self.quiet)
        telemetry.emit("proxy", "mode", **self.state)

    def describe(self):
        s = self.state
        d = s["mode"].upper()
        if s["mode"] != "clean":
            d += f" rate={s['rate']:.0%}"
        if s["mode"] == "noise":
            d += " word-swap" if s["pattern"] == "swap" else f" bits={s['bits']}"
        if s["delay_ms"]:
            d += f" delay={s['delay_ms']:.0f}ms"
        if s["loss"]:
            d += f" loss={s['loss']:.0%}"
        return d

    def _control_loop(self):
        u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        u.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            u.bind(("0.0.0.0", self.control_port))
        except OSError as e:
            log(f"control port {self.control_port} unavailable ({e}); live control disabled", "y", self.quiet)
            return
        while self._running:
            try:
                msg, _ = u.recvfrom(4096)
                self.set_state(**json.loads(msg))
            except (ValueError, TypeError):
                continue
            except OSError:
                break

    def _heartbeat(self):
        while self._running:
            telemetry.emit("proxy", "heartbeat", **self.state, **self.counters)
            time.sleep(1.5)

    # -- lifecycle -------------------------------------------------------------
    def start(self, background=False):
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind(("0.0.0.0", self.listen_port))
        self.listen_port = self._sock.getsockname()[1]
        self._sock.listen(8)
        self._running = True
        log(f"listening on :{self.listen_port} -> forwarding to {self.server_host}:{self.server_port}", "c",
            self.quiet)
        log(f"channel = {self.describe()}", "c", self.quiet)
        if self.control_port is not None:
            threading.Thread(target=self._control_loop, daemon=True).start()
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

    def _accept_loop(self):
        while self._running:
            try:
                c, addr = self._sock.accept()
            except OSError:
                break
            try:
                s = socket.create_connection((self.server_host, self.server_port), timeout=5)
                s.settimeout(None)
            except OSError as e:
                log(f"cannot reach server {self.server_host}:{self.server_port} ({e})", "r", self.quiet)
                telemetry.emit("proxy", "error", msg="server unreachable")
                c.close()
                continue
            for sk in (c, s):
                sk.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            threading.Thread(target=self._upstream, args=(c, s), daemon=True).start()
            threading.Thread(target=self._downstream, args=(s, c), daemon=True).start()

    # -- data path ---------------------------------------------------------------
    def _corrupt(self, frame, st):
        """Noise: random bit flips, or (pattern=swap) a swap of two 16-bit words. Reports exactly what was hit."""
        fec = bool(frame.flags & P.FLAG_FEC)
        info = {"pattern": "random", "bits": st["bits"], "fec": fec}
        if st["pattern"] == "swap":
            data = P.hamming_decode(frame.payload)[0] if fec else frame.payload
            data, swapped = swap_words(data, self.rng)
            if swapped:
                frame.payload = P.hamming_encode(data) if fec else data
                info = {"pattern": "swap", "bits": 0, "fec": fec, **swapped}
                log(f"chunk {frame.seq:>4}  swapped 16-bit words at byte {swapped['byte_a']} and "
                    f"{swapped['byte_b']}", "r", self.quiet)
        if info["pattern"] == "random":
            frame.payload, flips = flip_bits_detail(frame.payload, st["bits"], self.rng, fec)
            first = flips[0] if flips else {"byte": 0, "bit": 0}
            info["flips"] = flips[:4]
            info["wire_byte"], info["bit"] = first["byte"], first["bit"]
            info["byte"] = first["byte"] // 2 if fec else first["byte"]        # plaintext byte offset
            if fec and len(flips) == 1:
                info["syndrome"] = 7 - first["bit"]                          # what Hamming will compute
            log(f"chunk {frame.seq:>4}  flipped {st['bits']} bit(s)  (bit {first['bit']} of byte "
                f"{first['byte']})", "r", self.quiet)
        self.counters["corrupted"] += 1
        telemetry.emit("proxy", "corrupt", seq=frame.seq, **info)


    def _upstream(self, c, s):
        """client -> server, frame-aware so we can tamper with DATA payloads."""
        try:
            while True:
                frame = P.read_frame(c)
                with self._lock:
                    st = dict(self.state)
                if st["delay_ms"]:
                    time.sleep(st["delay_ms"] / 1000)
                if frame.type == P.DATA:
                    if st["loss"] and self.rng.random() < st["loss"]:
                        self.counters["dropped"] += 1
                        log(f"chunk {frame.seq:>4}  DROPPED (simulated loss)", "y", self.quiet)
                        telemetry.emit("proxy", "drop", seq=frame.seq)
                        continue
                    if st["mode"] == "noise" and self.rng.random() < st["rate"]:
                        self._corrupt(frame, st)
                    elif st["mode"] == "attack" and self.rng.random() < st["rate"]:
                        frame = forge_chunk(frame, self.rng)
                        self.counters["forged"] += 1
                        log(f"chunk {frame.seq:>4}  FORGED: injected '{ATTACK_MARK.decode()}' + recomputed CRC32",
                            "m", self.quiet)
                        telemetry.emit("proxy", "forge", seq=frame.seq)
                    else:
                        telemetry.emit("proxy", "pass", seq=frame.seq)
                self.counters["forwarded"] += 1
                s.sendall(frame.to_bytes())
        except (ConnectionError, OSError, P.ProtocolError):
            pass
        finally:
            for sk in (c, s):
                try:
                    sk.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def _downstream(self, s, c):
        """server -> client: forwarded untouched."""
        try:
            while True:
                buf = s.recv(65536)
                if not buf:
                    break
                c.sendall(buf)
        except OSError:
            pass
        finally:
            for sk in (c, s):
                try:
                    sk.close()
                except OSError:
                    pass


def main():
    ap = argparse.ArgumentParser(description="SecureTransfer channel proxy (noise / MITM attacker)")
    ap.add_argument("--port", type=int, default=config.PROXY_PORT)
    ap.add_argument("--server-host", default=config.SERVER_HOST)
    ap.add_argument("--server-port", type=int, default=config.SERVER_PORT)
    ap.add_argument("--mode", choices=["clean", "noise", "attack"], default="clean")
    ap.add_argument("--rate", type=float, default=0.1, help="fraction of chunks affected (0-1)")
    ap.add_argument("--bits", type=int, default=1, help="bits flipped per corrupted chunk (noise)")
    ap.add_argument("--pattern", choices=["random", "swap"], default="random",
                    help="noise pattern: random bit flips, or swap two 16-bit words (fools checksum16)")
    ap.add_argument("--delay", type=float, default=0, help="added latency per frame (ms)")
    ap.add_argument("--loss", type=float, default=0, help="fraction of DATA frames dropped (0-1)")
    a = ap.parse_args()
    try:
        Proxy(a.port, a.server_host, a.server_port, mode=a.mode, rate=a.rate, bits=a.bits,
              delay_ms=a.delay, loss=a.loss, pattern=a.pattern).start()
    except KeyboardInterrupt:
        log("stopped", "y")


if __name__ == "__main__":
    main()
