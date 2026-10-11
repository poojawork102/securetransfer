"""
SecureTransfer protocol — frame format, CRC32 / Internet checksum, Hamming(7,4) FEC and HMAC-SHA256.

Wire format (big-endian), 17-byte fixed header:

  0      2     3      4      5          9          13         17
  +------+-----+------+------+----------+----------+----------+------------------+-----------------+
  |MAGIC | VER | TYPE |FLAGS |   SEQ    |   LEN    |  CHECK   | HMAC (32B, opt.) | PAYLOAD (LEN B) |
  | 'FT' |  2  |  1B  |  1B  |   4B     |   4B     |   4B     |  if FLAG_HMAC    |                 |
  +------+-----+------+------+----------+----------+----------+------------------+-----------------+

  FLAGS bit0 = HMAC present, bit1 = payload is Hamming(7,4) encoded,
        bit2 = CHECK field holds the 16-bit Internet checksum (0 = CRC32). Added in VERSION 2.
  LEN    = length of the payload *on the wire* (after FEC encoding).
  CHECK  = CRC32 (32 bits) or Internet checksum (low 16 bits, upper 16 bits zero) of the
           *plaintext* data (before FEC encoding).
  HMAC   = HMAC-SHA256(key, header[0:17] || plaintext data).

Version 1 frames (always CRC32) are still accepted. Verification order on receive:
Hamming decode (fix 1-bit errors) -> CRC32 / checksum -> HMAC.
"""
import hashlib
import hmac as _hmac
import socket
import struct
import zlib
from dataclasses import dataclass

MAGIC = b"FT"
VERSION = 2
ACCEPTED_VERSIONS = (1, 2)
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
FLAG_CSUM16 = 0x04       # CHECK field is the 16-bit Internet checksum instead of CRC32

# Verification results
OK, CORRECTED, CRC_FAIL, HMAC_FAIL = "ok", "corrected", "crc_fail", "hmac_fail"
CSUM_FAIL = "checksum_fail"
BAD_STATUSES = (CRC_FAIL, CSUM_FAIL, HMAC_FAIL)
CHECK_MODES = ("crc32", "checksum16")


class ProtocolError(Exception):
    pass


# ---------------------------------------------------------------------------
# CRC32
# ---------------------------------------------------------------------------
def crc32(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


# ---------------------------------------------------------------------------
# 16-bit Internet checksum (RFC 1071): add all 16-bit words, fold the carries back in
# ("end-around carry"), then take the ones' complement.
# ---------------------------------------------------------------------------
def internet_checksum16(data: bytes) -> int:
    if len(data) % 2:
        data += b"\x00"                                    # odd length: pad with a zero byte
    total = sum(struct.unpack(f"!{len(data) // 2}H", data))
    while total >> 16:
        total = (total & 0xFFFF) + (total >> 16)           # wrap the carry around
    return ~total & 0xFFFF


def check_value(data: bytes, flags: int) -> int:
    """The error-detection value selected by the frame's FLAGS (CRC32 or checksum16)."""
    return internet_checksum16(data) if flags & FLAG_CSUM16 else crc32(data)


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


def hamming_fix_details(enc: bytes, limit: int = 8):
    """Where did Hamming correct something? Returns up to `limit` dicts: codeword index,
    plaintext byte offset, nibble (0 = high, 1 = low), the syndrome (= position 1..7 of the
    flipped bit) and the bit of the wire byte that was wrong (0 = LSB)."""
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
    crc: int                # the CHECK field (CRC32 or checksum16, see flags)
    mac: bytes
    payload: bytes          # bytes as they appeared on the wire (FEC-encoded if FLAG_FEC)
    version: int = VERSION  # kept so a v1 frame is re-serialised (and HMAC-checked) as a v1 frame

    @property
    def type_name(self):
        return TYPE_NAMES.get(self.type, str(self.type))

    @property
    def check_name(self):
        return "checksum16" if self.version >= 2 and self.flags & FLAG_CSUM16 else "crc32"

    def header_bytes(self) -> bytes:
        return pack_header(self.type, self.flags, self.seq, len(self.payload), self.crc, self.version)

    def to_bytes(self) -> bytes:
        return self.header_bytes() + (self.mac if self.flags & FLAG_HMAC else b"") + self.payload


def pack_header(ftype, flags, seq, length, crc, version=VERSION) -> bytes:
    return struct.pack(HEADER_FMT, MAGIC, version, ftype, flags, seq, length, crc)


def build_frame(ftype: int, seq: int, data: bytes = b"", *, use_hmac=False, use_fec=False,
                key: bytes = b"", check: str = "crc32") -> bytes:
    if check not in CHECK_MODES:
        raise ValueError(f"unknown check mode {check!r}")
    flags = ((FLAG_HMAC if use_hmac else 0) | (FLAG_FEC if use_fec else 0)
             | (FLAG_CSUM16 if check == "checksum16" else 0))
    payload = hamming_encode(data) if use_fec else data
    value = check_value(data, flags)
    header = pack_header(ftype, flags, seq, len(payload), value)
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
    if magic != MAGIC or ver not in ACCEPTED_VERSIONS:
        raise ProtocolError(f"bad magic/version: {magic!r} v{ver}")
    if length > MAX_PAYLOAD:
        raise ProtocolError(f"payload too large: {length}")
    mac = recv_exact(sock, HMAC_SIZE) if flags & FLAG_HMAC else b""
    payload = recv_exact(sock, length) if length else b""
    return Frame(ftype, flags, seq, crc, mac, payload, ver)


def open_frame(frame: Frame, key: bytes = b""):
    """Verify a frame. Returns (data, status, corrected_codewords)."""
    corrected = 0
    if frame.flags & FLAG_FEC:
        data, corrected = hamming_decode(frame.payload)
    else:
        data = frame.payload
    flags = frame.flags if frame.version >= 2 else frame.flags & ~FLAG_CSUM16   # v1 = always CRC32
    if check_value(data, flags) != frame.crc:
        return data, (CSUM_FAIL if flags & FLAG_CSUM16 else CRC_FAIL), corrected
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
