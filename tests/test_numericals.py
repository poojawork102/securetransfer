"""
The Numerical Lab must never disagree with the real protocol: every worked solution is checked against
protocol.py / zlib, and the textbook examples are checked against their known answers.
"""
import itertools
import os
import random
import socket
import sys
import unittest
import zlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numericals as N  # noqa: E402
import protocol as P  # noqa: E402


class TestChecksumSolver(unittest.TestCase):
    def test_textbook_example(self):
        s = N.solve("checksum", **N.example("checksum"))
        self.assertEqual(s["extra"]["checksum"], "11011111")
        self.assertEqual(s["transmitted"], "10110011" "01101100" "11011111")
        self.assertEqual(s["verdict"]["status"], "accept")

    def test_matches_protocol_for_16_bit_words(self):
        rng = random.Random(1)
        for n in (2, 3, 4, 7, 16, 25):
            data = rng.randbytes(n)
            s = N.solve("checksum", input="0x" + data.hex(), mode="hex", word=16)
            self.assertEqual(int(s["extra"]["checksum"], 2), P.internet_checksum16(data), n)
            self.assertTrue(s["extra"]["matches_protocol"])

    def test_text_input_hello(self):
        s = N.solve("checksum", input="HELLO", mode="text", word=16)
        self.assertEqual(int(s["extra"]["checksum"], 2), P.internet_checksum16(b"HELLO"))
        self.assertEqual(s["extra"]["padding_bits"], 8)                       # odd length -> padded to a whole word

    def test_receiver_accepts_clean_and_rejects_any_single_flip(self):
        for k in (8, 16):
            clean = N.solve("checksum", input="0xCAFEBABE1234", mode="hex", word=k)
            self.assertEqual(clean["verdict"]["status"], "accept")
            for bit in range(len(clean["transmitted"])):
                s = N.solve("checksum", input="0xCAFEBABE1234", mode="hex", word=k, flips=[bit])
                self.assertEqual(s["verdict"]["status"], "reject", (k, bit))

    def test_swapping_two_words_fools_checksum_but_crc_catches_it(self):
        s = N.solve("checksum", input="0x1111 2222 3333", mode="hex", word=16, swap="auto")
        self.assertEqual(s["verdict"]["status"], "undetected")
        cmp_ = s["extra"]["crc_compare"]
        self.assertTrue(cmp_["crc_detects"])
        self.assertFalse(cmp_["checksum_detects"])
        self.assertNotEqual(cmp_["sent_crc32"], cmp_["received_crc32"])

    def test_every_addition_step_is_internally_consistent(self):
        # sum row of each addition = operands added by hand in Python (with the carry-out digit)
        s = N.solve("checksum", input="0xFFFF 0x0001 0x8000", mode="hex", word=16)
        sums = [r for st in s["sender"] for r in st["rows"] if r["label"] == "sum" and len(r["bits"]) == 17]
        self.assertGreaterEqual(len(sums), 2)
        self.assertEqual(s["extra"]["checksum"], f"{(~((0xFFFF + 0x0001 + 0x8000) % 0xFFFF or 0xFFFF)) & 0xFFFF:016b}")


class TestCrcSolver(unittest.TestCase):
    def test_textbook_example(self):
        s = N.solve("crc", **N.example("crc"))
        self.assertEqual(s["extra"]["crc"], "100")
        self.assertEqual(s["transmitted"], "11010011101100100")
        self.assertEqual(s["extra"]["quotient"], "11110001111100")
        self.assertEqual(s["verdict"]["status"], "accept")

    def test_long_division_equals_shift_register_crc(self):
        rng = random.Random(2)
        for name, gen in (("crc3", "1011"), ("crc4", "10011"), ("crc8", "100000111"), ("odd", "110101")):
            for _ in range(25):
                bits = "".join(rng.choice("01") for _ in range(rng.randint(1, 60)))
                s = N.solve("crc", input=bits, mode="bin", generator=name if name != "odd" else gen)
                self.assertEqual(int(s["extra"]["crc"], 2), N.crc_bitwise(bits, gen))
                self.assertTrue(s["extra"]["bitwise_agrees"])

    def test_crc8_known_check_value(self):
        # CRC-8 (poly 0x07, init 0): check("123456789") = 0xF4
        bits = N.bytes_to_bits(b"123456789")
        self.assertEqual(N.crc_bitwise(bits, "100000111"), 0xF4)
        s = N.solve("crc", input="123456789", mode="text", generator="crc8")
        self.assertEqual(int(s["extra"]["crc"], 2), 0xF4)

    def test_codeword_is_divisible_by_generator(self):
        s = N.solve("crc", input="1011001", mode="bin", generator="crc4")
        self.assertEqual(N.crc_bitwise(s["transmitted"][:-4], "10011"), int(s["transmitted"][-4:], 2))
        _, _, rem = N.long_division(s["transmitted"], "10011")
        self.assertEqual(rem, "0000")

    def test_every_single_bit_flip_is_rejected(self):
        for g in ("crc3", "crc4", "crc8"):
            base = N.solve("crc", input="1101001110110", mode="bin", generator=g)
            for bit in range(len(base["transmitted"])):
                s = N.solve("crc", input="1101001110110", mode="bin", generator=g, flips=[bit])
                self.assertEqual(s["verdict"]["status"], "reject", (g, bit))

    def test_error_equal_to_generator_multiple_is_undetectable(self):
        # flipping exactly the bits of the generator (a multiple of itself) leaves remainder 0
        s = N.solve("crc", input="11010011101100", mode="bin", generator="crc3", flips=[0, 2, 3])
        self.assertEqual(s["verdict"]["status"], "undetected")

    def test_crc32_matches_zlib_and_protocol(self):
        rng = random.Random(3)
        for n in (1, 2, 5, 9, 32):
            data = rng.randbytes(n)
            s = N.solve("crc", input="0x" + data.hex(), mode="hex", generator="crc32")
            self.assertEqual(int(s["extra"]["crc"], 2), zlib.crc32(data) & 0xFFFFFFFF)
            self.assertEqual(int(s["extra"]["crc"], 2), P.crc32(data))
            self.assertTrue(s["extra"]["matches_zlib"] and s["extra"]["matches_protocol"])

    def test_crc32_by_division_equals_zlib(self):
        for data in (b"", b"a", b"123456789", os.urandom(200)):
            self.assertEqual(N.crc32_by_division(data)[0], zlib.crc32(data) & 0xFFFFFFFF)
        self.assertEqual(N.crc32_by_division(b"123456789")[0], 0xCBF43926)         # the standard CRC-32 check value

    def test_crc32_receiver_detects_flip(self):
        s = N.solve("crc", input="HELLO", mode="text", generator="crc32", flips=[3])
        self.assertEqual(s["verdict"]["status"], "reject")

    def test_polynomial_strings(self):
        self.assertEqual(N.poly_str("1011"), "x³ + x + 1")
        self.assertEqual(N.poly_str("100000111"), "x⁸ + x² + x + 1")


class TestHammingSolver(unittest.TestCase):
    def test_textbook_example_codeword_and_correction(self):
        s = N.solve("hamming", **N.example("hamming"))
        self.assertEqual(s["transmitted"], "0110011")
        s = N.solve("hamming", input="1011", mode="bin", flips=[5])               # bit 6 (index 5)
        self.assertEqual(s["extra"]["syndrome"], 6)
        self.assertEqual(s["verdict"]["status"], "corrected")
        self.assertEqual(s["extra"]["corrected_data"], "1011")

    def test_codeword_equals_protocol_for_every_nibble(self):
        for n in range(16):
            s = N.solve("hamming", input=f"{n:04b}", mode="bin")
            self.assertEqual(s["transmitted"], f"{P.hamming74_encode_nibble(n):07b}")
            self.assertTrue(s["extra"]["matches_protocol"])

    def test_single_flip_syndrome_and_decode_equal_protocol(self):
        for n, bit in itertools.product(range(16), range(7)):
            s = N.solve("hamming", input=f"{n:04b}", mode="bin", flips=[bit])
            cw = P.hamming74_encode_nibble(n) ^ (1 << (6 - bit))
            nib, pos = P.hamming74_decode_byte(cw)
            self.assertEqual(s["extra"]["syndrome"], pos)
            self.assertEqual(s["extra"]["syndrome"], bit + 1)
            self.assertEqual(int(s["extra"]["corrected_data"], 2), nib)
            self.assertEqual(s["verdict"]["status"], "corrected")
            self.assertTrue(s["extra"]["protocol_decode"]["agrees"])

    def test_two_bit_errors_are_miscorrected(self):
        for n, (a, b) in itertools.product(range(16), itertools.combinations(range(7), 2)):
            s = N.solve("hamming", input=f"{n:04b}", mode="bin", flips=[a, b])
            self.assertEqual(s["verdict"]["status"], "miscorrected", (n, a, b))
            self.assertNotEqual(s["extra"]["corrected_data"], f"{n:04b}")
            cw = P.hamming74_encode_nibble(n) ^ (1 << (6 - a)) ^ (1 << (6 - b))
            self.assertEqual(f"{P.hamming74_decode_byte(cw)[0]:04b}", s["extra"]["corrected_data"])   # protocol is fooled too

    def test_general_mode_12_8(self):
        s = N.solve("hamming", input="10110010", mode="bin", scheme="general")
        self.assertEqual((s["extra"]["n"], s["extra"]["m"], s["extra"]["r"]), (12, 8, 4))
        for bit in range(12):
            t = N.solve("hamming", input="10110010", mode="bin", scheme="general", flips=[bit])
            self.assertEqual(t["verdict"]["status"], "corrected", bit)
            self.assertEqual(t["extra"]["syndrome"], bit + 1)

    def test_odd_parity_works(self):
        for bit in range(7):
            s = N.solve("hamming", input="1011", mode="bin", parity="odd", flips=[bit])
            self.assertEqual(s["verdict"]["status"], "corrected")
        self.assertEqual(N.solve("hamming", input="1011", mode="bin", parity="odd")["verdict"]["status"], "accept")

    def test_number_of_parity_bits_formula(self):
        for m in range(1, 27):
            r, n, ppos, dpos = N.hamming_layout(m)
            self.assertGreaterEqual(2 ** r, m + r + 1)
            self.assertLess(2 ** (r - 1), m + (r - 1) + 1)
            self.assertEqual((n, len(dpos)), (m + r, m))

    def test_74_requires_exactly_four_bits(self):
        with self.assertRaises(ValueError):
            N.solve("hamming", input="10110", mode="bin")


class TestInputsAndExamples(unittest.TestCase):
    def test_parsing(self):
        self.assertEqual(N.parse_bits("1011 0011")[0], "10110011")
        self.assertEqual(N.parse_bits("0x4865")[0], "0100100001100101")
        self.assertEqual(N.parse_bits("Hi")[0], "0100100001101001")
        self.assertEqual(N.parse_bits("0110", "text")[0], N.bytes_to_bits(b"0110"))

    def test_bad_input_is_a_value_error(self):
        for kind, kw in (("checksum", {"input": ""}), ("crc", {"input": "012", "mode": "bin"}),
                         ("hamming", {"input": "0xZZ", "mode": "hex"}), ("crc", {"input": "1", "generator": "abc"}),
                         ("checksum", {"input": "1" * 1000, "mode": "bin"}), ("nope", {})):
            with self.assertRaises(ValueError, msg=(kind, kw)):
                N.solve(kind, **kw)

    def test_all_random_examples_solve_and_accept(self):
        for kind in ("checksum", "crc", "hamming"):
            for seed in range(40):
                s = N.solve(kind, **N.example(kind, "random", seed))
                self.assertEqual(s["verdict"]["status"], "accept", (kind, seed))
                self.assertTrue(s["sender"] and s["receiver"])

    def test_flips_toggle_and_ignore_out_of_range(self):
        s = N.solve("crc", input="1101", mode="bin", flips=[0, 0, 1, 999, -3])
        self.assertEqual(s["flips"], [1])

    def test_render_text_is_generated_from_the_solution(self):
        text = N.render_text(N.solve("hamming", input="1011", mode="bin"))
        self.assertIn("0110011", text)
        self.assertIn("P2 ⊕ 1 ⊕ 1 ⊕ 1 = 0  →  P2 = 1", text)


class TestCompare(unittest.TestCase):
    DATA = "0xCAFE1234"

    def rows(self, scenario, **kw):
        c = N.compare(self.DATA, scenario=scenario, **kw)
        return c, {r["name"]: r for r in c["rows"]}

    def test_no_error_everyone_accepts(self):
        c, r = self.rows("none")
        self.assertFalse(c["changed"])
        self.assertTrue(all(x["status"] == "ok" and x["safe"] for x in r.values()))

    def test_one_bit_detected_by_checksum_and_crc_repaired_by_hamming(self):
        _, r = self.rows("1bit")
        self.assertEqual(r["16-bit checksum"]["status"], "detected")
        self.assertEqual(r["CRC-8"]["status"], "detected")
        self.assertEqual(r["Hamming(7,4) alone"]["status"], "corrected")
        self.assertEqual(r["Hamming + CRC (our protocol)"]["status"], "corrected")

    def test_two_bits_same_block_fool_hamming_alone_but_not_hamming_plus_crc(self):
        _, r = self.rows("2bit_same")
        self.assertEqual(r["Hamming(7,4) alone"]["status"], "miscorrected")
        self.assertFalse(r["Hamming(7,4) alone"]["safe"])
        self.assertEqual(r["Hamming + CRC (our protocol)"]["status"], "detected")
        self.assertEqual(r["16-bit checksum"]["status"], "detected")

    def test_two_bits_far_apart_are_both_repaired(self):
        _, r = self.rows("2bit_far")
        self.assertEqual(r["Hamming(7,4) alone"]["status"], "corrected")
        self.assertEqual(r["CRC-8"]["status"], "detected")

    def test_word_swap_fools_checksum_and_hamming_but_not_crc(self):
        c, r = self.rows("swap")
        self.assertIsNotNone(c["swap"])
        self.assertEqual(r["16-bit checksum"]["status"], "undetected")
        self.assertEqual(r["Hamming(7,4) alone"]["status"], "undetected")
        self.assertEqual(r["CRC-8"]["status"], "detected")
        self.assertEqual(r["Hamming + CRC (our protocol)"]["status"], "detected")

    def test_custom_flips_are_applied(self):
        c, r = self.rows("custom", flips=[0, 9])
        self.assertEqual(c["flips"], [0, 9])
        self.assertNotEqual(c["data_bits"], c["received_bits"])
        self.assertEqual(r["Hamming(7,4) alone"]["status"], "corrected")

    def test_hamming_plus_crc_agrees_with_the_real_frame_pipeline(self):
        rng = random.Random(8)
        for scenario in ("1bit", "2bit_same", "2bit_far"):
            for _ in range(10):
                data = rng.randbytes(4)
                c = N.compare("0x" + data.hex(), scenario=scenario)
                raw = bytearray(P.build_frame(P.DATA, 0, data, use_fec=True))
                for f in c["flips"]:                          # same damage on the real wire format
                    nib, j = divmod(f, 4)
                    raw[P.HEADER_SIZE + nib] ^= 1 << (7 - N.HAMMING_DATA_POS[j])
                a, b = socket.socketpair()
                a.sendall(bytes(raw))
                frame = P.read_frame(b)
                a.close(); b.close()
                got, status, _ = P.open_frame(frame)
                row = next(x for x in c["rows"] if x["name"] == "Hamming + CRC (our protocol)")
                expected = {"corrected": P.CORRECTED, "detected": P.CRC_FAIL, "ok": P.OK}[row["status"]]
                self.assertEqual(status, expected, (scenario, data.hex()))
                alone = next(x for x in c["rows"] if x["name"] == "Hamming(7,4) alone")
                self.assertEqual(N.bytes_to_bits(got) == c["data_bits"], alone["status"] in ("ok", "corrected"))

    def test_bad_input(self):
        with self.assertRaises(ValueError):
            N.compare("1" * 70, mode="bin")
        with self.assertRaises(ValueError):
            N.compare("1011", scenario="nope")


class TestPractice(unittest.TestCase):
    def test_every_question_type_is_answerable_and_checked(self):
        for kind in N.PRACTICE_KINDS:
            for seed in range(30):
                q = N.practice_question(kind, seed)
                right = N.practice_check(q, "?")["expected"]
                self.assertTrue(N.practice_check(q, right)["correct"], (kind, seed))
                wrong = "reject" if right == "accept" else "accept" if kind == "accept_reject" else "x" + right
                self.assertFalse(N.practice_check(q, wrong)["correct"], (kind, seed))
                self.assertTrue(q["prompt"] and q["format"])

    def test_answer_normalisation(self):
        q = N.practice_question("crc", 1)
        expected = N.practice_check(q, "")["expected"]
        spaced = " ".join(expected)
        self.assertTrue(N.practice_check(q, spaced)["correct"])
        q = N.practice_question("accept_reject", 2)
        exp = N.practice_check(q, "")["expected"]
        self.assertTrue(N.practice_check(q, exp[0].upper())["correct"])

    def test_hamming_locate_answer_is_the_flipped_position(self):
        for seed in range(20):
            q = N.practice_question("hamming_locate", seed)
            self.assertEqual(N.practice_check(q, "")["expected"], str(q["flips"][0] + 1))

    def test_questions_are_reproducible_by_seed(self):
        self.assertEqual(N.practice_question("checksum", 5), N.practice_question("checksum", 5))
        self.assertNotEqual(N.practice_question("checksum", 5), N.practice_question("checksum", 6))

    def test_unknown_kind(self):
        with self.assertRaises(ValueError):
            N.practice_question("nope")


if __name__ == "__main__":
    unittest.main(verbosity=2)
