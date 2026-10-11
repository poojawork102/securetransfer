"""
SecureTransfer protocol — frame format, CRC32, Hamming(7,4) FEC and HMAC-SHA256.

Wire format (big-endian), 17-byte fixed header:

  0      2     3      4      5          9          13         17
  +------+-----+------+------+----------+----------+----------+------------------+-----------------+
  |MAGIC | VER | TYPE |FLAGS |   SEQ    |   LEN    |  CRC32   | HMAC (32B, opt.) | PAYLOAD (LEN B) |
  | 'FT' |  1  |  1B  |  1B  |   4B     |   4B     |   4B     |  if FLAG_HMAC    |                 |
  +------+-----+------+------+----------+----------+----------+------------------+-----------------+

  FLAGS bit0 = HMAC present, bit1 = payload is Hamming(7,4) encoded.
  LEN    = length of the payload *on the wire* (after FEC encoding).
  CRC32  = CRC32 of the *plaintext* data (before FEC encoding).
  HMAC   = HMAC-SHA256(key, header[0:17] || plaintext data).

Verification order on receive: Hamming decode (fix 1-bit errors) -> CRC32 -> HMAC.
"""
import hashlib
import hmac as _hmac
import socket
import struct
import zlib
from dataclasses import dataclass

MAGIC = b"FT"
VERSION = 1
HEADER_FMT = "!2sBBBIII"
HEADER_SIZE = struct.calcsize(HEADER_FMT)  # 17
HMAC_SIZE = 32
MAX_PAYLOAD = 16 * 1024 * 1024

# Message types
META, DATA, ACK, NACK, DONE, RESULT, ERR = 1, 2, 3, 4, 5, 6, 7
TYPE_NAMES = {META: "META", DATA: "DATA", ACK: "ACK", NACK: "NACK",
              DONE: "DONE", RESULT: "RESULT", ERR: "ERR"}

# Flags
FLAG_HMAC = 0x01
FLAG_FEC = 0x02

# Verification results
OK, CORRECTED, CRC_FAIL, HMAC_FAIL = "ok", "corrected", "crc_fail", "hmac_fail"


class ProtocolError(Exception):
    pass


# ---------------------------------------------------------------------------
# CRC32
# ---------------------------------------------------------------------------
def crc32(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


# ---------------------------------------------------------------------------
# Hamming(7,4)
# Codeword stored in the low 7 bits of a byte. Bit positions 1..7 = p1 p2 d1 p3 d2 d3 d4,
# position 1 is the MSB of those 7 bits (bit 6), position 7 is bit 0.
# Each data byte -> 2 codewords (high nibble, low nibble) -> 2 bytes on the wire.
# ---------------------------------------------------------------------------
def hamming74_encode_nibble(n: int) -> int:
    d1, d2, d3, d4 = (n >> 3) & 1, (n >> 2) & 1, (n >> 1) & 1, n & 1
    p1 = d1 ^ d2 ^ d4
    p2 = d1 ^ d3 ^ d4
    p3 = d2 ^ d3 ^ d4
    bits = [p1, p2, d1, p3, d2, d3, d4]           # positions 1..7
    cw = 0
    for b in bits:
        cw = (cw << 1) | b
    return cw


def hamming74_decode_byte(cw: int):
    """Return (nibble, error_position) — error_position 0 means no error, 1..7 = bit corrected."""
    cw &= 0x7F
    bits = [(cw >> (6 - i)) & 1 for i in range(7)]  # bits[0] = position 1
    p1, p2, d1, p3, d2, d3, d4 = bits
    s1 = p1 ^ d1 ^ d2 ^ d4
    s2 = p2 ^ d1 ^ d3 ^ d4
    s3 = p3 ^ d2 ^ d3 ^ d4
    syndrome = s1 | (s2 << 1) | (s3 << 2)          # = position of the flipped bit
    if syndrome:
        bits[syndrome - 1] ^= 1
        p1, p2, d1, p3, d2, d3, d4 = bits
    return (d1 << 3) | (d2 << 2) | (d3 << 1) | d4, syndrome


# Lookup tables so encoding/decoding runs at C speed via bytes.translate
_ENC_HI = bytes(hamming74_encode_nibble(b >> 4) for b in range(256))
_ENC_LO = bytes(hamming74_encode_nibble(b & 0x0F) for b in range(256))
_DEC_HI = bytes(hamming74_decode_byte(b)[0] << 4 for b in range(256))
_DEC_LO = bytes(hamming74_decode_byte(b)[0] for b in range(256))
_DEC_ERR = bytes(1 if hamming74_decode_byte(b)[1] else 0 for b in range(256))


def hamming_encode(data: bytes) -> bytes:
    out = bytearray(len(data) * 2)
    out[0::2] = data.translate(_ENC_HI)
    out[1::2] = data.translate(_ENC_LO)
    return bytes(out)


def hamming_decode(enc: bytes):
    """Return (data, corrected_codewords). Corrects any single-bit error per 7-bit codeword."""
    if len(enc) % 2:
        raise ProtocolError("Hamming payload must have even length")
    hi = enc[0::2].translate(_DEC_HI)
    lo = enc[1::2].translate(_DEC_LO)
    n = len(hi)
    data = (int.from_bytes(hi, "big") | int.from_bytes(lo, "big")).to_bytes(n, "big") if n else b""
    corrected = enc.translate(_DEC_ERR).count(1)
    return data, corrected


# ---------------------------------------------------------------------------
# HMAC
# ---------------------------------------------------------------------------
def compute_hmac(key: bytes, header: bytes, data: bytes) -> bytes:
    return _hmac.new(key, header + data, hashlib.sha256).digest()


# ---------------------------------------------------------------------------
# Frames
# ---------------------------------------------------------------------------
@dataclass
class Frame:
    type: int
    flags: int
    seq: int
    crc: int
    mac: bytes
    payload: bytes          # bytes as they appeared on the wire (FEC-encoded if FLAG_FEC)

    @property
    def type_name(self):
        return TYPE_NAMES.get(self.type, str(self.type))

    def header_bytes(self) -> bytes:
        return pack_header(self.type, self.flags, self.seq, len(self.payload), self.crc)

    def to_bytes(self) -> bytes:
        return self.header_bytes() + (self.mac if self.flags & FLAG_HMAC else b"") + self.payload


def pack_header(ftype, flags, seq, length, crc) -> bytes:
    return struct.pack(HEADER_FMT, MAGIC, VERSION, ftype, flags, seq, length, crc)


def build_frame(ftype: int, seq: int, data: bytes = b"", *, use_hmac=False, use_fec=False,
                key: bytes = b"") -> bytes:
    flags = (FLAG_HMAC if use_hmac else 0) | (FLAG_FEC if use_fec else 0)
    payload = hamming_encode(data) if use_fec else data
    crc = crc32(data)
    header = pack_header(ftype, flags, seq, len(payload), crc)
    mac = compute_hmac(key, header, data) if use_hmac else b""
    return header + mac + payload


def recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("connection closed by peer")
        buf += chunk
    return bytes(buf)


def read_frame(sock: socket.socket) -> Frame:
    header = recv_exact(sock, HEADER_SIZE)
    magic, ver, ftype, flags, seq, length, crc = struct.unpack(HEADER_FMT, header)
    if magic != MAGIC or ver != VERSION:
        raise ProtocolError(f"bad magic/version: {magic!r} v{ver}")
    if length > MAX_PAYLOAD:
        raise ProtocolError(f"payload too large: {length}")
    mac = recv_exact(sock, HMAC_SIZE) if flags & FLAG_HMAC else b""
    payload = recv_exact(sock, length) if length else b""
    return Frame(ftype, flags, seq, crc, mac, payload)


def open_frame(frame: Frame, key: bytes = b""):
    """Verify a frame. Returns (data, status, corrected_codewords)."""
    corrected = 0
    if frame.flags & FLAG_FEC:
        data, corrected = hamming_decode(frame.payload)
    else:
        data = frame.payload
    if crc32(data) != frame.crc:
        return data, CRC_FAIL, corrected
    if frame.flags & FLAG_HMAC:
        expected = compute_hmac(key, frame.header_bytes(), data)
        if not _hmac.compare_digest(expected, frame.mac):
            return data, HMAC_FAIL, corrected
    return data, (CORRECTED if corrected else OK), corrected


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 16), b""):
            h.update(block)
    return h.hexdigest()
