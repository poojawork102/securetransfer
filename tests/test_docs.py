"""The documentation must not drift away from the code."""
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "docs"))
import build_docs  # noqa: E402


def all_test_ids():
    """Every test in tests/ as 'file.Class.method'."""
    def walk(suite):
        for t in suite:
            if isinstance(t, unittest.TestSuite):
                yield from walk(t)
            else:
                yield t
    suite = unittest.TestLoader().discover(os.path.join(ROOT, "tests"))
    return {f"{t.__class__.__module__.split('.')[-1]}.{t.__class__.__name__}.{t._testMethodName}" for t in walk(suite)}


class TestDocs(unittest.TestCase):
    def test_generated_blocks_are_current(self):
        stale = build_docs.main(check=True)
        self.assertEqual(stale, [], "run `python docs/build_docs.py` to refresh: " + ", ".join(stale))

    def test_every_test_is_in_this_report(self):
        with open(os.path.join(ROOT, "docs", "TEST_REPORT.md"), encoding="utf-8") as fh:
            report = fh.read()
        listed = set(re.findall(r"`(test_\w+\.\w+\.test_\w+)`", report))
        actual = all_test_ids()
        self.assertEqual(sorted(actual - listed), [], "tests missing from docs/TEST_REPORT.md")
        self.assertEqual(sorted(listed - actual), [], "docs/TEST_REPORT.md lists tests that do not exist")
        m = re.search(r"\*\*(\d+) / (\d+) passed\*\*", report)
        self.assertIsNotNone(m, "heading must say '**N / N passed**'")
        self.assertEqual((int(m.group(1)), int(m.group(2))), (len(actual), len(actual)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
