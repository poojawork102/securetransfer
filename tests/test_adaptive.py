"""
Auto Defense tests.
  A. rules engine (adaptive.py) — one test per row of the rules table, no sockets
  B. closed loop end-to-end — real server + proxy, client.send_file(auto=True)
"""
import glob
import os
import random
import shutil
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import adaptive as A  # noqa: E402
import client  # noqa: E402
import telemetry  # noqa: E402
from proxy import Proxy  # noqa: E402
from server import FileServer  # noqa: E402

telemetry.disable()
KEY = b"adaptive-key"
S = A.Settings(fec=False, hmac=False, chunk_size=1024)


def hist(*statuses, start=0):
    """History helper: every status gets its own chunk number."""
    return [(start + i, s) for i, s in enumerate(statuses)]


class TestRulesEngine(unittest.TestCase):
    def test_clean_link_no_action(self):
        self.assertIsNone(A.decide(hist(*[A.OK] * 40), S))

    def test_empty_history_no_action(self):
        self.assertIsNone(A.decide([], S))

    # row 1: CRC-fail rate >= 10 % and FEC off -> FEC on
    def test_noisy_link_enables_fec(self):
        d = A.decide(hist(*([A.OK] * 4 + [A.CHECK_FAIL]) * 4), S)         # 20 % failures
        self.assertEqual(d.action, "fec_on")
        self.assertTrue(d.settings.fec)
        self.assertIn("Hamming error correction enabled", d.reason)
        self.assertIn("20% errors", d.reason)

    def test_single_failure_is_not_noise(self):
        self.assertIsNone(A.decide(hist(A.CHECK_FAIL, *[A.OK] * 9), S))

    def test_too_few_samples_no_decision(self):
        self.assertIsNone(A.decide(hist(A.CHECK_FAIL, A.CHECK_FAIL, A.OK), S))

    def test_below_threshold_no_action(self):
        # 2 failures in 20 transmissions = exactly 10 % -> triggers; 2 in 21 does not (only the last 20 count)
        self.assertEqual(A.decide(hist(*[A.OK] * 18 + [A.CHECK_FAIL] * 2), S).action, "fec_on")
        self.assertIsNone(A.decide(hist(A.CHECK_FAIL, A.OK, A.CHECK_FAIL, *[A.OK] * 18), S))

    # row 2: FEC on and still failing (bursts) -> halve chunk size, min 256
    def test_burst_errors_halve_chunk(self):
        fec = A.Settings(True, False, 1024)
        d = A.decide(hist(*([A.OK] * 4 + [A.CHECK_FAIL]) * 4), fec)
        self.assertEqual((d.action, d.settings.chunk_size), ("halve_chunk", 512))
        self.assertTrue(d.settings.fec)
        self.assertIn("smaller chunks", d.reason)

    def test_chunk_size_floor(self):
        fec = A.Settings(True, False, 256)
        self.assertIsNone(A.decide(hist(*([A.OK] * 4 + [A.CHECK_FAIL]) * 4), fec))
        self.assertEqual(A.decide(hist(*([A.OK] * 4 + [A.CHECK_FAIL]) * 4), A.Settings(True, False, 300))
                         .settings.chunk_size, 256)

    # row 3: clean again for 30 transmissions, FEC on -> FEC off
    def test_clean_again_disables_fec(self):
        fec = A.Settings(True, False, 1024)
        d = A.decide(hist(*[A.OK] * 30), fec)
        self.assertEqual(d.action, "fec_off")
        self.assertFalse(d.settings.fec)
        self.assertIn("Hamming disabled", d.reason)

    def test_fec_stays_on_while_errors_are_still_being_corrected(self):
        fec = A.Settings(True, False, 1024)
        self.assertIsNone(A.decide(hist(*[A.OK] * 29), fec))                       # not long enough
        self.assertIsNone(A.decide(hist(*[A.OK] * 14 + [A.CORRECTED] + [A.OK] * 15), fec))   # 1/30 = 3.3 %

    def test_fec_off_rule_needs_fec_on(self):
        self.assertIsNone(A.decide(hist(*[A.OK] * 40), S))

    # row 4: any HMAC failure -> intrusion alert, HMAC stays on
    def test_hmac_failure_raises_intrusion_alert(self):
        h = A.Settings(False, True, 1024)
        d = A.decide(hist(A.OK, A.OK, A.HMAC_FAIL, start=12), h)
        self.assertEqual(d.action, "intrusion_alert")
        self.assertTrue(d.settings.hmac)
        self.assertIn("chunk 14", d.reason)
        self.assertIn("channel compromised", d.reason)

    def test_alert_is_raised_once(self):
        h = A.Settings(False, True, 1024)
        self.assertIsNone(A.decide(hist(A.OK, A.HMAC_FAIL), h, compromised=True))

    # row 5: same chunk fails N times -> give up
    def test_give_up_after_n_failures_on_one_chunk(self):
        h = [(5, A.OK)] + [(7, A.CHECK_FAIL)] * 8
        d = A.decide(h, S)
        self.assertEqual(d.action, "give_up")
        self.assertIn("Gave up after 8 attempts", d.reason)
        seven = A.decide([(7, A.CHECK_FAIL)] * 7, S)
        self.assertTrue(seven is None or seven.action != "give_up")

    def test_failures_on_different_chunks_do_not_count_as_consecutive(self):
        h = [(i, A.CHECK_FAIL) for i in range(10)]
        d = A.decide(h, A.Settings(True, False, 256))
        self.assertTrue(d is None or d.action != "give_up")

    def test_timeouts_count_towards_give_up(self):
        self.assertEqual(A.decide([(3, A.TIMEOUT)] * 8, S).action, "give_up")

    # row 6: final SHA-256 mismatch
    def test_sha_mismatch_without_hmac_retries_with_hmac(self):
        d = A.decide_after_verify(False, S, attempt=1)
        self.assertEqual(d.action, "retry_with_hmac")
        self.assertTrue(d.settings.hmac)
        self.assertIn("quarantined", d.reason)

    def test_no_retry_when_verified_or_already_hmac_or_out_of_attempts(self):
        self.assertIsNone(A.decide_after_verify(True, S, 1))
        self.assertIsNone(A.decide_after_verify(False, A.Settings(False, True, 1024), 1))
        self.assertIsNone(A.decide_after_verify(False, S, 2))

    # monitor
    def test_monitor_applies_decision_and_clears_history(self):
        m = A.Monitor(S)
        decisions = [m.record(i, A.CHECK_FAIL if i % 3 == 0 else A.OK) for i in range(24)]
        first = next(d for d in decisions if d)
        self.assertEqual(first.action, "fec_on")
        self.assertTrue(m.settings.fec)
        self.assertLess(len(m.history), 24)

    def test_monitor_remembers_forged_chunks(self):
        m = A.Monitor(A.Settings(False, True, 1024))
        for seq in (3, 3, 9):
            m.record(seq, A.HMAC_FAIL)
        self.assertEqual(m.forged_seqs, [3, 9])
        self.assertTrue(m.compromised)


class ClosedLoopBase(unittest.TestCase):
    """Fresh server + proxy per test so each scenario is deterministic."""
    FILE_SIZE = 100 * 1024 + 123

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.server = FileServer(port=0, out_dir=os.path.join(self.tmp, "received"), key=KEY, quiet=True,
                                 quarantine_dir=os.path.join(self.tmp, "quarantine")).start(background=True)
        self.proxy = Proxy(0, server_port=self.server.port, control_port=None, seed=42,
                           quiet=True).start(background=True)
        self.file = os.path.join(self.tmp, "src.bin")
        with open(self.file, "wb") as f:
            f.write(random.Random(7).randbytes(self.FILE_SIZE))
        time.sleep(0.05)

    def tearDown(self):
        self.proxy.stop()
        self.server.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def send(self, mode="clean", rate=0.2, bits=1, auto=True, **kw):
        self.proxy.set_state(mode=mode, rate=rate, bits=bits)
        return client.send_file(self.file, "127.0.0.1", self.proxy.listen_port, key=KEY, quiet=True,
                                auto=auto, **kw)

    def quarantined(self):
        return sorted(glob.glob(os.path.join(self.tmp, "quarantine", "*.rejected")))

    def received(self):
        return [f for f in os.listdir(os.path.join(self.tmp, "received")) if not f.startswith(".")]


class TestClosedLoop(ClosedLoopBase):
    def test_clean_link_takes_no_action(self):
        s = self.send("clean")
        self.assertTrue(s["verified"])
        self.assertEqual(s["decisions"], [])
        self.assertEqual(s["final_protection"], {"fec": False, "hmac": False, "check": "crc32", "chunk_size": 1024})
        self.assertEqual(s["verdict"], "verified")

    def test_noisy_link_enables_hamming_automatically(self):
        s = self.send("noise", rate=0.3, bits=1)
        self.assertTrue(s["verified"])
        actions = [d["action"] for d in s["decisions"]]
        self.assertIn("fec_on", actions)
        self.assertTrue(s["final_protection"]["fec"])
        self.assertGreater(s["server_stats"]["corrected"], 0)
        fec_on = next(d for d in s["decisions"] if d["action"] == "fec_on")
        self.assertIn("Noisy link detected", fec_on["reason"])

    def test_auto_beats_plain_crc_arq_on_retransmits(self):
        auto = self.send("noise", rate=0.3, bits=1)
        manual = self.send("noise", rate=0.3, bits=1, auto=False)
        self.assertLess(auto["retransmits"], manual["retransmits"])

    def test_burst_errors_shrink_the_chunk_size(self):
        s = self.send("noise", rate=0.3, bits=3)
        self.assertTrue(s["verified"])
        actions = [d["action"] for d in s["decisions"]]
        self.assertEqual(actions[0], "fec_on")
        self.assertIn("halve_chunk", actions)
        self.assertLess(s["final_protection"]["chunk_size"], 1024)
        self.assertGreater(s["chunks"], 101)             # smaller chunks -> more of them, file still intact

    def test_link_recovers_and_hamming_turns_off_again(self):
        self.proxy.set_state(mode="noise", rate=0.3, bits=1)

        def heal():                                        # the link becomes clean after 60 frames
            while self.proxy.counters["forwarded"] < 60:
                time.sleep(0.002)
            self.proxy.set_state(mode="clean")
        threading.Thread(target=heal, daemon=True).start()
        s = client.send_file(self.file, "127.0.0.1", self.proxy.listen_port, key=KEY, quiet=True, auto=True)
        self.assertTrue(s["verified"])
        actions = [d["action"] for d in s["decisions"]]
        self.assertEqual(actions[:2], ["fec_on", "fec_off"])
        self.assertFalse(s["final_protection"]["fec"])

    def test_attack_without_hmac_is_quarantined_then_resent_with_hmac(self):
        s = self.send("attack", rate=0.2)
        self.assertTrue(s["verified"])
        self.assertEqual(len(s["attempts"]), 2)
        self.assertFalse(s["attempts"][0]["verified"])
        self.assertTrue(s["attempts"][1]["verified"])
        self.assertTrue(s["final_protection"]["hmac"])
        self.assertEqual(s["decisions"][0]["action"], "retry_with_hmac")
        # the bad copy is in quarantine with a sidecar, the good copy in received/
        bad = self.quarantined()
        self.assertEqual(len(bad), 1)
        self.assertTrue(os.path.isfile(bad[0] + ".json"))
        with open(bad[0], "rb") as fh:
            self.assertIn(b"HACKED!!", fh.read())
        self.assertEqual(self.received(), ["src.bin"])
        with open(os.path.join(self.tmp, "received", "src.bin"), "rb") as a, open(self.file, "rb") as b:
            self.assertEqual(a.read(), b.read())
        # during the HMAC attempt the forgeries are blocked and reported as intrusion alerts
        self.assertIn("intrusion_alert", [d["action"] for d in s["decisions"]])
        self.assertTrue(s["forged_seqs"])

    def test_attack_with_hmac_from_the_start_raises_alert_without_quarantine(self):
        s = self.send("attack", rate=0.2, use_hmac=True)
        self.assertTrue(s["verified"])
        self.assertEqual(len(s["attempts"]), 1)
        self.assertEqual(self.quarantined(), [])
        self.assertEqual(s["decisions"][0]["action"], "intrusion_alert")

    def test_giving_up_quarantines_the_partial_file(self):
        with self.assertRaises(client.TransferError) as cm:
            self.send("noise", rate=1.0, max_retries=4)
        self.assertIn("Gave up after 4 attempts", str(cm.exception))
        self.assertEqual(cm.exception.stats["decisions"][-1]["action"], "give_up")
        time.sleep(0.3)
        self.assertEqual(len(self.quarantined()), 1)
        self.assertEqual(self.received(), [])


class TestNoBadFileInReceived(ClosedLoopBase):
    def test_manual_mode_still_shows_crc_being_fooled_but_file_is_quarantined(self):
        s = self.send("attack", rate=0.2, auto=False)
        self.assertFalse(s["verified"])                  # CRC accepted every forged chunk...
        self.assertEqual(s["retransmits"], 0)
        self.assertEqual(s["verdict"], "rejected")
        self.assertEqual(self.received(), [])            # ...but the bad file never reaches received/
        self.assertEqual(len(self.quarantined()), 1)
        self.assertTrue(s["quarantine_path"].endswith(".rejected"))

    def test_sidecar_explains_the_rejection(self):
        import json
        self.send("attack", rate=0.2, auto=False)
        with open(self.quarantined()[0] + ".json", encoding="utf-8") as fh:
            info = json.load(fh)
        self.assertEqual(info["reason"], "sha256_mismatch")
        self.assertNotEqual(info["expected_sha256"], info["got_sha256"])

    def test_dropped_connection_quarantines_partial_upload(self):
        import socket
        import protocol as P
        sock = socket.create_connection(("127.0.0.1", self.server.port))
        meta = b'{"name":"half.bin","size":5000,"chunks":5,"chunk_size":1000,"sha256":"00"}'
        sock.sendall(P.build_frame(P.META, 0, meta))
        P.read_frame(sock)
        sock.sendall(P.build_frame(P.DATA, 0, b"x" * 1000))
        P.read_frame(sock)
        sock.close()
        time.sleep(0.4)
        self.assertEqual(self.received(), [])
        self.assertEqual(len(self.quarantined()), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
