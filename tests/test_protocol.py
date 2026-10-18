"""Unit tests for the protocol layer: Hamming(7,4), CRC32, HMAC, frame encode/decode."""
import os
import random
import socket
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import protocol as P  # noqa: E402
from proxy import flip_bits, forge_chunk  # noqa: E402

KEY = b"test-key"


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
        # 2 flips in one codeword -> wrong correction, which the check must catch
        data = b"A" * 64
        raw = bytearray(P.build_frame(P.DATA, 0, data, use_fec=True))
        raw[P.HEADER_SIZE] ^= 0b0000011
        _, status, _ = P.open_frame(frame_from_bytes(bytes(raw)))
        self.assertIn(status, P.BAD_STATUSES)


class TestFrames(unittest.TestCase):
    def test_roundtrip_all_flag_combinations(self):
        data = os.urandom(1000)
        for h in (False, True):
            for f in (False, True):
                fr = frame_from_bytes(P.build_frame(P.DATA, 42, data, use_hmac=h, use_fec=f, key=KEY))
                got, status, _ = P.open_frame(fr, KEY)
                self.assertEqual((got, status, fr.seq), (data, P.OK, 42))

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


class TestAttack(unittest.TestCase):
    def test_forgery_fools_crc_without_hmac(self):
        data = b"transfer 100 rupees to Pooja. " * 20
        fr = forge_chunk(frame_from_bytes(P.build_frame(P.DATA, 3, data)), random.Random(0))
        got, status, _ = P.open_frame(frame_from_bytes(fr.to_bytes()))
        self.assertEqual(status, P.OK)          # CRC fooled...
        self.assertNotEqual(got, data)          # ...but the data is wrong
        self.assertIn(b"HACKED!!", got)

    def test_forgery_caught_by_hmac(self):
        data = b"transfer 100 rupees to Pooja. " * 20
        for fec in (False, True):
            raw = P.build_frame(P.DATA, 3, data, use_hmac=True, use_fec=fec, key=KEY)
            fr = forge_chunk(frame_from_bytes(raw), random.Random(0))
            _, status, _ = P.open_frame(frame_from_bytes(fr.to_bytes()), KEY)
            self.assertEqual(status, P.HMAC_FAIL)

    def test_wrong_key_rejected(self):
        fr = frame_from_bytes(P.build_frame(P.DATA, 0, b"data", use_hmac=True, key=b"other"))
        self.assertEqual(P.open_frame(fr, KEY)[1], P.HMAC_FAIL)

    def test_flip_bits_changes_payload(self):
        rng = random.Random(3)
        p = bytes(100)
        self.assertNotEqual(flip_bits(p, 1, rng, False), p)
        self.assertNotEqual(flip_bits(p, 2, rng, True), p)


if __name__ == "__main__":
    unittest.main(verbosity=2)
