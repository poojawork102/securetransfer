"""16-bit Internet checksum mode, protocol v1 compatibility and the word-swap error pattern."""
import os
import random
import shutil
import socket
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import client  # noqa: E402
import protocol as P  # noqa: E402
import telemetry  # noqa: E402
from proxy import Proxy, swap_words  # noqa: E402
from server import FileServer  # noqa: E402

telemetry.disable()
KEY = b"checksum-key"


def frame_from_bytes(raw: bytes) -> P.Frame:
    a, b = socket.socketpair()
    try:
        a.sendall(raw)
        return P.read_frame(b)
    finally:
        a.close()
        b.close()


class TestInternetChecksum(unittest.TestCase):
    def test_rfc1071_example(self):
        # RFC 1071 section 3: words 0001 f203 f4f5 f6f7 sum to ddf2 (after end-around carry)
        self.assertEqual(P.internet_checksum16(bytes.fromhex("0001f203f4f5f6f7")), 0x220D)

    def test_receiver_sum_is_all_ones(self):
        rng = random.Random(5)
        for n in (0, 1, 2, 3, 100, 1001):
            data = rng.randbytes(n)
            data += b"\x00" * (len(data) % 2)
            c = P.internet_checksum16(data)
            self.assertEqual(P.internet_checksum16(data + c.to_bytes(2, "big")), 0)   # complement of all-ones

    def test_odd_length_is_zero_padded(self):
        self.assertEqual(P.internet_checksum16(b"\x12\x34\x56"), P.internet_checksum16(b"\x12\x34\x56\x00"))

    def test_detects_every_single_bit_error(self):
        data = random.Random(1).randbytes(64)
        good = P.internet_checksum16(data)
        for bit in range(len(data) * 8):
            bad = bytearray(data)
            bad[bit // 8] ^= 1 << (bit % 8)
            self.assertNotEqual(P.internet_checksum16(bytes(bad)), good)


class TestChecksumFrames(unittest.TestCase):
    def test_roundtrip_all_flag_combinations(self):
        data = os.urandom(777)
        for h in (False, True):
            for f in (False, True):
                for chk in P.CHECK_MODES:
                    fr = frame_from_bytes(P.build_frame(P.DATA, 9, data, use_hmac=h, use_fec=f, key=KEY, check=chk))
                    self.assertEqual(fr.check_name, chk)
                    self.assertEqual(P.open_frame(fr, KEY)[:2], (data, P.OK))

    def test_check_field_is_16_bit_and_flag_is_set(self):
        fr = frame_from_bytes(P.build_frame(P.DATA, 0, b"hello world!", check="checksum16"))
        self.assertTrue(fr.flags & P.FLAG_CSUM16)
        self.assertLess(fr.crc, 1 << 16)
        self.assertEqual(fr.crc, P.internet_checksum16(b"hello world!"))

    def test_bit_flip_reports_checksum_fail(self):
        raw = bytearray(P.build_frame(P.DATA, 0, b"hello world" * 20, check="checksum16"))
        raw[P.HEADER_SIZE + 5] ^= 0x10
        self.assertEqual(P.open_frame(frame_from_bytes(bytes(raw)))[1], P.CSUM_FAIL)

    def test_fec_corrects_with_checksum_mode(self):
        data = b"hello world" * 20
        raw = bytearray(P.build_frame(P.DATA, 0, data, use_fec=True, check="checksum16"))
        raw[P.HEADER_SIZE + 7] ^= 0x04
        got, status, fixed = P.open_frame(frame_from_bytes(bytes(raw)))
        self.assertEqual((got, status, fixed), (data, P.CORRECTED, 1))

    def test_unknown_check_mode_rejected(self):
        with self.assertRaises(ValueError):
            P.build_frame(P.DATA, 0, b"x", check="md5")

    def test_version_1_frames_still_accepted(self):
        data = b"legacy frame" * 10
        header = P.pack_header(P.DATA, 0, 3, len(data), P.crc32(data), version=1)
        fr = frame_from_bytes(header + data)
        self.assertEqual(fr.version, 1)
        self.assertEqual(P.open_frame(fr)[:2], (data, P.OK))

    def test_version_1_with_hmac_verifies_against_its_own_header(self):
        data = b"legacy frame" * 10
        flags = P.FLAG_HMAC
        header = P.pack_header(P.DATA, flags, 3, len(data), P.crc32(data), version=1)
        raw = header + P.compute_hmac(KEY, header, data) + data
        fr = frame_from_bytes(raw)
        self.assertEqual(P.open_frame(fr, KEY)[1], P.OK)
        self.assertEqual(fr.to_bytes(), raw)                 # re-serialising keeps it a v1 frame

    def test_future_version_rejected(self):
        raw = bytearray(P.build_frame(P.ACK, 0))
        raw[2] = 9
        with self.assertRaises(P.ProtocolError):
            frame_from_bytes(bytes(raw))

    def test_hamming_fix_details_report_syndrome(self):
        enc = bytearray(P.hamming_encode(b"ABCD"))
        enc[3] ^= 1 << 1                                     # flip bit 1 of codeword #3 -> position 6
        fixes = P.hamming_fix_details(bytes(enc))
        self.assertEqual(fixes, [{"codeword": 3, "byte": 1, "nibble": 1, "syndrome": 6, "wire_bit": 1}])


class TestWordSwap(unittest.TestCase):
    def test_swap_fools_checksum16_but_not_crc32(self):
        data = random.Random(3).randbytes(512)
        swapped, info = swap_words(data, random.Random(4))
        self.assertIsNotNone(info)
        self.assertNotEqual(swapped, data)
        self.assertEqual(P.internet_checksum16(swapped), P.internet_checksum16(data))     # sum unchanged
        self.assertNotEqual(P.crc32(swapped), P.crc32(data))

    def test_swap_needs_two_different_words(self):
        self.assertIsNone(swap_words(b"\x00\x00" * 10, random.Random(1))[1])
        self.assertIsNone(swap_words(b"ab", random.Random(1))[1])


class TestSwapThroughProxy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.server = FileServer(port=0, out_dir=os.path.join(self.tmp, "r"), key=KEY, quiet=True,
                                 quarantine_dir=os.path.join(self.tmp, "q")).start(background=True)
        self.proxy = Proxy(0, server_port=self.server.port, control_port=None, seed=11, quiet=True,
                           mode="noise", rate=0.3, pattern="swap").start(background=True)
        self.file = os.path.join(self.tmp, "src.bin")
        with open(self.file, "wb") as f:
            f.write(random.Random(7).randbytes(60 * 1024))
        time.sleep(0.05)

    def tearDown(self):
        self.proxy.stop()
        self.server.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def send(self, **kw):
        return client.send_file(self.file, "127.0.0.1", self.proxy.listen_port, key=KEY, quiet=True, **kw)

    def test_checksum_is_fooled_by_reordering(self):
        s = self.send(check="checksum16")
        self.assertFalse(s["verified"])                      # corrupted file got through every chunk check
        self.assertEqual(s["retransmits"], 0)
        self.assertEqual(s["server_stats"]["checksum_fail"], 0)

    def test_crc32_catches_the_same_reordering(self):
        s = self.send(check="crc32")
        self.assertTrue(s["verified"])
        self.assertGreater(s["server_stats"]["crc_fail"], 0)

    def test_checksum_still_catches_random_bit_flips(self):
        self.proxy.set_state(pattern="random", bits=1)
        s = self.send(check="checksum16")
        self.assertTrue(s["verified"])
        self.assertGreater(s["server_stats"]["checksum_fail"], 0)
        self.assertEqual(s["retransmits"], s["server_stats"]["checksum_fail"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
