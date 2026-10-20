"""
End-to-end tests: real server + proxy on random ports, real TCP sockets.
Covers normal operation and failure conditions required by the project brief.
"""
import os
import random
import socket
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import client  # noqa: E402
import telemetry  # noqa: E402
from proxy import Proxy  # noqa: E402
from server import FileServer  # noqa: E402

telemetry.disable()


class TestTransfer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.server = FileServer(port=0, out_dir=cls.tmp, quiet=True).start(background=True)
        cls.proxy = Proxy(0, server_port=cls.server.port, control_port=None, seed=42,
                          quiet=True).start(background=True)
        cls.file = os.path.join(cls.tmp, "src.bin")
        with open(cls.file, "wb") as f:
            f.write(random.Random(7).randbytes(100 * 1024 + 123))
        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.proxy.stop()
        cls.server.stop()

    def send(self, mode="clean", rate=0.2, bits=1, delay_ms=0, loss=0.0, **kw):
        self.proxy.set_state(mode=mode, rate=rate, bits=bits, delay_ms=delay_ms, loss=loss)
        return client.send_file(self.file, "127.0.0.1", self.proxy.listen_port, quiet=True, **kw)

    # ---- normal conditions
    def test_01_clean_transfer(self):
        s = self.send("clean")
        self.assertTrue(s["verified"])
        self.assertEqual(s["retransmits"], 0)

    def test_02_direct_to_server(self):
        s = client.send_file(self.file, "127.0.0.1", self.server.port, quiet=True)
        self.assertTrue(s["verified"])

    def test_03_empty_file(self):
        p = os.path.join(self.tmp, "empty.txt")
        open(p, "wb").close()
        s = client.send_file(p, "127.0.0.1", self.server.port, quiet=True)
        self.assertTrue(s["verified"])

    # ---- noise
    def test_10_noise_detected_and_retransmitted(self):
        s = self.send("noise", rate=0.3)
        self.assertTrue(s["verified"])
        check_fails = s["server_stats"].get("crc_fail", 0) + s["server_stats"].get("checksum_fail", 0)
        self.assertGreater(check_fails, 0)
        self.assertEqual(s["retransmits"], check_fails)

    def test_11_hamming_corrects_without_retransmit(self):
        s = self.send("noise", rate=0.3, bits=1, use_fec=True)
        self.assertTrue(s["verified"])
        self.assertEqual(s["retransmits"], 0)
        self.assertGreater(s["server_stats"]["corrected"], 0)

    def test_12_hamming_burst_falls_back_to_retransmit(self):
        s = self.send("noise", rate=0.3, bits=3, use_fec=True)
        self.assertTrue(s["verified"])
        check_fails = s["server_stats"].get("crc_fail", 0) + s["server_stats"].get("checksum_fail", 0)
        self.assertGreater(check_fails, 0)

    # ---- loss / latency / failures
    def test_30_frame_loss_recovered_by_timeout(self):
        s = self.send("clean", loss=0.05, timeout=0.3, chunk_size=4096)
        self.assertTrue(s["verified"])
        self.assertGreater(s["timeouts"], 0)

    def test_31_latency_increases_rtt(self):
        fast = self.send("clean", chunk_size=8192)
        slow = self.send("clean", delay_ms=5, chunk_size=8192)
        self.assertGreater(slow["avg_rtt_ms"], fast["avg_rtt_ms"] + 3)

    def test_40_server_down(self):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        dead = s.getsockname()[1]
        s.close()
        with self.assertRaises(client.TransferError):
            client.send_file(self.file, "127.0.0.1", dead, quiet=True)

    def test_41_retry_limit(self):
        with self.assertRaises(client.TransferError):
            self.send("noise", rate=1.0, max_retries=3)
        self.proxy.set_state(mode="clean")


if __name__ == "__main__":
    unittest.main(verbosity=2)
