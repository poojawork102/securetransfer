"""
SecureTransfer protocol -- frame format, CRC32 / Internet checksum, Hamming(7,4) FEC.

Wire format (big-endian), 17-byte fixed header:

  0      2     3      4      5          9          13         17
  +------+-----+------+------+----------+----------+----------+-----------------+
  |MAGIC | VER | TYPE |FLAGS |   SEQ    |   LEN    |  CHECK   | PAYLOAD (LEN B) |
  | 'FT' |  2  |  1B  |  1B  |   4B     |   4B     |   4B     |                 |
  +------+-----+------+------+----------+----------+----------+-----------------+

  FLAGS bit0 = reserved, bit1 = payload is Hamming(7,4) encoded,
        bit2 = CHECK field holds the 16-bit Internet checksum (0 = CRC32).
  LEN    = length of the payload *on the wire* (after FEC encoding).
  CHECK  = CRC32 (32 bits) or Internet checksum (low 16 bits, upper 16 bits zero) of the
           *plaintext* data (before FEC encoding).

Verification order on receive: Hamming decode (fix 1-bit errors) -> CRC32 / checksum.
"""
import hashlib
import socket
import struct
import zlib
from dataclasses import dataclass

MAGIC = b"FT"
VERSION = 2
ACCEPTED_VERSIONS = (1, 2)
HEADER_FMT = "!2sBBBIII"
HEADER_SIZE = struct.calcsize(HEADER_FMT)  # 17
MAX_PAYLOAD = 16 * 1024 * 1024

# Message types
META, DATA, ACK, NACK, DONE, RESULT, ERR = 1, 2, 3, 4, 5, 6, 7
TYPE_NAMES = {META: "META", DATA: "DATA", ACK: "ACK", NACK: "NACK",
              DONE: "DONE", RESULT: "RESULT", ERR: "ERR"}

# Flags
FLAG_FEC = 0x02
FLAG_CSUM16 = 0x04

# Verification results
OK, CORRECTED, CRC_FAIL = "ok", "corrected", "crc_fail"
CSUM_FAIL = "checksum_fail"
BAD_STATUSES = (CRC_FAIL, CSUM_FAIL)
CHECK_MODES = ("crc32", "checksum16")


class ProtocolError(Exception):
    pass


# ---------------------------------------------------------------------------
# CRC32
# ---------------------------------------------------------------------------
def crc32(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


# ---------------------------------------------------------------------------
# 16-bit Internet checksum (RFC 1071)
# ---------------------------------------------------------------------------
def internet_checksum16(data: bytes) -> int:
    if len(data) % 2:
        data += b"\x00"
    total = sum(struct.unpack(f"!{len(data) // 2}H", data))
    while total >> 16:
        total = (total & 0xFFFF) + (total >> 16)
    return ~total & 0xFFFF


def check_value(data: bytes, flags: int) -> int:
    return internet_checksum16(data) if flags & FLAG_CSUM16 else crc32(data)


# ---------------------------------------------------------------------------
# Hamming(7,4)
# ---------------------------------------------------------------------------
def hamming74_encode_nibble(n: int) -> int:
    d1, d2, d3, d4 = (n >> 3) & 1, (n >> 2) & 1, (n >> 1) & 1, n & 1
    p1 = d1 ^ d2 ^ d4
    p2 = d1 ^ d3 ^ d4
    p3 = d2 ^ d3 ^ d4
    bits = [p1, p2, d1, p3, d2, d3, d4]
    cw = 0
    for b in bits:
        cw = (cw << 1) | b
    return cw


def hamming74_decode_byte(cw: int):
    cw &= 0x7F
    bits = [(cw >> (6 - i)) & 1 for i in range(7)]
    p1, p2, d1, p3, d2, d3, d4 = bits
    s1 = p1 ^ d1 ^ d2 ^ d4
    s2 = p2 ^ d1 ^ d3 ^ d4
    s3 = p3 ^ d2 ^ d3 ^ d4
    syndrome = s1 | (s2 << 1) | (s3 << 2)
    if syndrome:
        bits[syndrome - 1] ^= 1
        p1, p2, d1, p3, d2, d3, d4 = bits
    return (d1 << 3) | (d2 << 2) | (d3 << 1) | d4, syndrome


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
    if len(enc) % 2:
        raise ProtocolError("Hamming payload must have even length")
    hi = enc[0::2].translate(_DEC_HI)
    lo = enc[1::2].translate(_DEC_LO)
    n = len(hi)
    data = (int.from_bytes(hi, "big") | int.from_bytes(lo, "big")).to_bytes(n, "big") if n else b""
    corrected = enc.translate(_DEC_ERR).count(1)
    return data, corrected


def hamming_fix_details(enc: bytes, limit: int = 8):
    out, flags, i = [], enc.translate(_DEC_ERR), 0
    while len(out) < limit:
        i = flags.find(1, i)
        if i < 0:
            break
        syndrome = hamming74_decode_byte(enc[i])[1]
        out.append({"codeword": i, "byte": i // 2, "nibble": i % 2, "syndrome": syndrome,
                    "wire_bit": 7 - syndrome})
        i += 1
    return out


# ---------------------------------------------------------------------------
# Frames
# ---------------------------------------------------------------------------
@dataclass
class Frame:
    type: int
    flags: int
    seq: int
    crc: int
    payload: bytes
    version: int = VERSION

    @property
    def type_name(self):
        return TYPE_NAMES.get(self.type, str(self.type))

    @property
    def check_name(self):
        return "checksum16" if self.version >= 2 and self.flags & FLAG_CSUM16 else "crc32"

    def header_bytes(self) -> bytes:
        return pack_header(self.type, self.flags, self.seq, len(self.payload), self.crc, self.version)

    def to_bytes(self) -> bytes:
        return self.header_bytes() + self.payload


def pack_header(ftype, flags, seq, length, crc, version=VERSION) -> bytes:
    return struct.pack(HEADER_FMT, MAGIC, version, ftype, flags, seq, length, crc)


def build_frame(ftype: int, seq: int, data: bytes = b"", *, use_fec=False,
                check: str = "checksum16") -> bytes:
    if check not in CHECK_MODES:
        raise ValueError(f"unknown check mode {check!r}")
    flags = (FLAG_FEC if use_fec else 0) | (FLAG_CSUM16 if check == "checksum16" else 0)
    payload = hamming_encode(data) if use_fec else data
    value = check_value(data, flags)
    header = pack_header(ftype, flags, seq, len(payload), value)
    return header + payload


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
    if magic != MAGIC or ver not in ACCEPTED_VERSIONS:
        raise ProtocolError(f"bad magic/version: {magic!r} v{ver}")
    if length > MAX_PAYLOAD:
        raise ProtocolError(f"payload too large: {length}")
    payload = recv_exact(sock, length) if length else b""
    return Frame(ftype, flags, seq, crc, payload, ver)


def open_frame(frame: Frame):
    """Verify a frame. Returns (data, status, corrected_codewords)."""
    corrected = 0
    if frame.flags & FLAG_FEC:
        data, corrected = hamming_decode(frame.payload)
    else:
        data = frame.payload
    flags = frame.flags if frame.version >= 2 else frame.flags & ~FLAG_CSUM16
    if check_value(data, flags) != frame.crc:
        return data, (CSUM_FAIL if flags & FLAG_CSUM16 else CRC_FAIL), corrected
    return data, (CORRECTED if corrected else OK), corrected


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 16), b""):
            h.update(block)
    return h.hexdigest()
