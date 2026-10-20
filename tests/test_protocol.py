"""Unit tests for the protocol layer: Hamming(7,4), CRC32, frame encode/decode."""
import os
import random
import socket
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import protocol as P  # noqa: E402
from proxy import flip_bits_detail  # noqa: E402


def frame_from_bytes(raw: bytes) -> P.Frame:
    a, b = socket.socketpair()
    try:
        a.sendall(raw)
        return P.read_frame(b)
    finally:
        a.close()
        b.close()


class TestHamming(unittest.TestCase):
    def test_roundtrip_all_bytes(self):
        data = bytes(range(256))
        dec, fixed = P.hamming_decode(P.hamming_encode(data))
        self.assertEqual(dec, data)
        self.assertEqual(fixed, 0)

    def test_corrects_every_single_bit_position(self):
        for nibble in range(16):
            cw = P.hamming74_encode_nibble(nibble)
            for bit in range(7):
                got, pos = P.hamming74_decode_byte(cw ^ (1 << bit))
                self.assertEqual(got, nibble)
                self.assertNotEqual(pos, 0)

    def test_corrects_one_error_per_codeword(self):
        rng = random.Random(1)
        data = rng.randbytes(4096)
        enc = bytearray(P.hamming_encode(data))
        for i in range(len(enc)):
            enc[i] ^= 1 << rng.randrange(7)
        dec, fixed = P.hamming_decode(bytes(enc))
        self.assertEqual(dec, data)
        self.assertEqual(fixed, len(enc))

    def test_two_bit_error_is_not_silently_trusted(self):
        data = b"A" * 64
        raw = bytearray(P.build_frame(P.DATA, 0, data, use_fec=True))
        raw[P.HEADER_SIZE] ^= 0b0000011
        _, status, _ = P.open_frame(frame_from_bytes(bytes(raw)))
        self.assertIn(status, P.BAD_STATUSES)


class TestFrames(unittest.TestCase):
    def test_roundtrip_plain(self):
        data = os.urandom(1000)
        fr = frame_from_bytes(P.build_frame(P.DATA, 42, data))
        got, status, _ = P.open_frame(fr)
        self.assertEqual((got, status, fr.seq), (data, P.OK, 42))

    def test_roundtrip_with_fec(self):
        data = os.urandom(1000)
        fr = frame_from_bytes(P.build_frame(P.DATA, 7, data, use_fec=True))
        got, status, _ = P.open_frame(fr)
        self.assertEqual((got, status, fr.seq), (data, P.OK, 7))

    def test_checksum_detects_bit_flip(self):
        data = b"hello world" * 50
        raw = bytearray(P.build_frame(P.DATA, 1, data))
        raw[P.HEADER_SIZE + 10] ^= 0x04
        _, status, _ = P.open_frame(frame_from_bytes(bytes(raw)))
        self.assertIn(status, P.BAD_STATUSES)

    def test_fec_corrects_bit_flip(self):
        data = b"hello world" * 50
        raw = bytearray(P.build_frame(P.DATA, 1, data, use_fec=True))
        raw[P.HEADER_SIZE + 10] ^= 0x04
        got, status, fixed = P.open_frame(frame_from_bytes(bytes(raw)))
        self.assertEqual((got, status, fixed), (data, P.CORRECTED, 1))

    def test_bad_magic_rejected(self):
        raw = b"XX" + P.build_frame(P.ACK, 0)[2:]
        with self.assertRaises(P.ProtocolError):
            frame_from_bytes(raw)


class TestFlipBits(unittest.TestCase):
    def test_flip_bits_changes_payload(self):
        rng = random.Random(3)
        p = bytes(100)
        changed, flips = flip_bits_detail(p, 1, rng, False)
        self.assertNotEqual(changed, p)
        self.assertEqual(len(flips), 1)

    def test_burst_flip_with_fec(self):
        rng = random.Random(4)
        p = bytes(100)
        changed, flips = flip_bits_detail(p, 2, rng, True)
        self.assertNotEqual(changed, p)
        self.assertEqual(len(flips), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
