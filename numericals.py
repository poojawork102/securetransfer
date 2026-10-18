"""
Numerical Lab engine — solves checksum, CRC and Hamming problems step by step, in 0/1 form,
exactly the way a textbook answer is written.

Single source of truth: the dashboard only renders what this module returns. Every result is
unit-tested against protocol.py / zlib (tests/test_numericals.py), so the teaching version and the
real protocol can never disagree.

A solution is a plain dict (JSON-friendly):
    transmitted : the bit string that goes over the channel
    segments    : which bits are data / checksum / CRC / parity (for colouring)
    sender      : list of steps         receiver : list of steps (after the chosen bit flips)
    verdict     : {"status": accept | reject | corrected | miscorrected | undetected, "text": ...}
A step is {"title", "text", "rows": [row...], "group", "collapsed"} and a row is
    {"label", "bits", "cls", "indent", "hl": [[char_index, css_class], ...], "note"}
"""
import random
import re
import zlib

import protocol as P

MAX_BITS = 256
SUP = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")
GENERATORS = {"crc3": "1011", "crc4": "10011", "crc8": "100000111",
              "crc32": "100000100110000010001110110110111"}
CRC32_POLY_BITS = GENERATORS["crc32"]


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
def _row(label, bits, cls="", indent=0, hl=None, note=""):
    return {"label": label, "bits": bits, "cls": cls, "indent": indent, "hl": hl or [], "note": note}


def _step(title, text, rows=None, group=None, collapsed=False):
    return {"title": title, "text": text, "rows": rows or [], "group": group, "collapsed": collapsed}


def _ones(s, cls):
    """Highlight every '1' of a bit string."""
    return [[i, cls] for i, c in enumerate(s) if c == "1"]


def xor_bits(a, b):
    return "".join("1" if x != y else "0" for x, y in zip(a, b))


def invert(bits):
    return "".join("1" if c == "0" else "0" for c in bits)


def group4(bits, n=4):
    return " ".join(bits[i:i + n] for i in range(0, len(bits), n))


def bits_to_bytes(bits):
    bits += "0" * (-len(bits) % 8)
    return bytes(int(bits[i:i + 8], 2) for i in range(0, len(bits), 8))


def bytes_to_bits(data):
    return "".join(f"{b:08b}" for b in data)


def poly_str(gen):
    """'1011' -> 'x³ + x + 1'"""
    terms = []
    for i, c in enumerate(gen):
        if c == "1":
            e = len(gen) - 1 - i
            terms.append("1" if e == 0 else "x" if e == 1 else "x" + str(e).translate(SUP))
    return " + ".join(terms)


def parse_bits(text, mode="auto"):
    """Text / hex (0x..) / binary -> (bit string, detected mode)."""
    t = (text or "").strip()
    if mode == "auto":
        if t.lower().startswith("0x"):
            mode = "hex"
        elif t and set(t) <= set("01 _"):
            mode = "bin"
        else:
            mode = "text"
    if mode == "hex":
        h = re.sub(r"[\s_]|0x", "", t, flags=re.I)                 # allow "0x4865" or "0x48 0x65" or "48 65"
        if not h or not re.fullmatch(r"[0-9a-fA-F]+", h):
            raise ValueError("hex input must look like 0x4865 or 48 65")
        bits = "".join(f"{int(c, 16):04b}" for c in h)
    elif mode == "bin":
        bits = re.sub(r"[\s_]", "", t)
        if not bits or set(bits) - set("01"):
            raise ValueError("binary input may contain only 0 and 1")
    elif mode == "text":
        if not t:
            raise ValueError("please enter some data")
        bits = bytes_to_bits(t.encode("utf-8"))
    else:
        raise ValueError(f"unknown input mode {mode!r}")
    if len(bits) > MAX_BITS:
        raise ValueError(f"input too long for the Lab ({len(bits)} bits; limit {MAX_BITS})")
    return bits, mode


def _apply_flips(bits, flips):
    """Toggle the listed bit positions (a position listed twice cancels out)."""
    flipped = set()
    for i in flips or []:
        i = int(i)
        if 0 <= i < len(bits):
            flipped ^= {i}
    out = list(bits)
    for i in flipped:
        out[i] = "1" if out[i] == "0" else "0"
    return "".join(out), sorted(flipped)


def _hex_of(bits):
    return "0x" + bits_to_bytes(bits).hex() if len(bits) % 4 == 0 and len(bits) % 8 == 0 else ""


# ---------------------------------------------------------------------------
# 1) Internet checksum (ones' complement sum)
# ---------------------------------------------------------------------------
def _add_rows(a, b, k, label_a, label_b):
    """Column addition of two k-bit words with a visible carry row. Display is k+1 columns wide
    (column 0 = the carry-out digit). Returns (rows, sum_k_bits, carry_out)."""
    carries, s_bits, c = ["0"] * (k + 1), ["0"] * k, 0
    for j in range(k - 1, -1, -1):
        s = int(a[j]) + int(b[j]) + c
        s_bits[j], c = str(s & 1), s >> 1
        carries[j] = str(c)                    # carry produced at bit j lands in the column to its left
    carries[k] = " "
    carry_row = "".join(carries)
    total = str(c) + "".join(s_bits)
    rows = [_row("carries", carry_row, "carry", hl=_ones(carry_row, "carry")),
            _row(label_a, a, indent=1),
            _row(label_b, b, indent=1),
            _row("", "-" * (k + 1)),
            _row("sum", total, "sum", hl=[[0, "carry"]] if c else [])]
    return rows, "".join(s_bits), c


def _ones_complement_sum(words, k, steps, label="running sum"):
    """Add words one by one with end-around carry, appending a step per addition. Returns the final sum."""
    acc = words[0]
    if len(words) == 1:
        steps.append(_step("Only one word", f"With a single word the sum is the word itself: {acc}.",
                           [_row("sum", acc, "sum", indent=1)]))
        return acc
    for n, w in enumerate(words[1:], start=2):
        rows, low, carry = _add_rows(acc, w, k, label if n > 2 else "w1", f"+ w{n}")
        text = f"Add word {n} to the {'sum so far' if n > 2 else 'first word'}."
        if carry:
            text += " A carry fell out of the left end → wrap it around: add it back at the right."
            wrap_rows, low2, c2 = _add_rows(low, "0" * (k - 1) + "1", k, "sum (no carry)", "+ carry 1")
            rows += [_row("carry out = 1", "wrap around ↓", "note")] + wrap_rows
            low = low2
        else:
            text += " No carry out of the left end, so nothing to wrap."
        steps.append(_step(f"Add word {n}", text, rows))
        acc = low
    return acc


def solve_checksum(text, mode="auto", word=8, flips=(), swap=None):
    bits, mode = parse_bits(text, mode)
    k = int(word)
    if k not in (8, 16):
        raise ValueError("word size must be 8 or 16")
    pad = -len(bits) % k
    data = bits + "0" * pad
    words = [data[i:i + k] for i in range(0, len(data), k)]
    if len(words) > 24:
        raise ValueError("too many words for the Lab (max 24)")

    # ---- sender ----
    sender = [_step(
        f"Split the data into {k}-bit words",
        f"The data is {len(bits)} bits long. We treat it as a list of {k}-bit numbers."
        + (f" The last word is padded with {pad} zero bit{'s' if pad > 1 else ''}." if pad else ""),
        [_row(f"w{i}", w, indent=1, note=_hex_of(w)) for i, w in enumerate(words, 1)])]
    total = _ones_complement_sum(words, k, sender)
    checksum = invert(total)
    sender.append(_step("Sum of all words", f"The ones'-complement sum of the {len(words)} words is {total}.",
                        [_row("sum", total, "sum", indent=1)]))
    sender.append(_step("Complement → checksum", "Flip every bit of the sum (ones' complement). That is the checksum.",
                        [_row("sum", total, indent=1), _row("checksum", checksum, "result", indent=1,
                                                             hl=_ones(checksum, "result"), note=_hex_of(checksum))]))
    transmitted = data + checksum
    sender.append(_step("Transmit data + checksum", "The checksum is sent right after the data words.",
                        [_row("sent", group4(transmitted, k), "result")]))

    # ---- channel: optional word swap, then bit flips ----
    received, swapped = data, None
    if swap:
        if swap == "auto" or not isinstance(swap, (list, tuple)):
            pairs = [(i, j) for i in range(len(words)) for j in range(i + 1, len(words)) if words[i] != words[j]]
            swap = pairs[0] if pairs else None
        if swap:
            i, j = sorted(int(x) for x in swap)
            if 0 <= i < j < len(words) and words[i] != words[j]:
                ws = list(words)
                ws[i], ws[j] = ws[j], ws[i]
                received, swapped = "".join(ws), (i, j)
    received_tx, valid_flips = _apply_flips(received + checksum, flips)

    # ---- receiver ----
    rwords = [received_tx[i:i + k] for i in range(0, len(received_tx), k)]
    receiver = [_step("Received words", "The receiver splits what arrived into the same-sized words "
                      "(the last one is the checksum)." + (f" Words {swapped[0] + 1} and {swapped[1] + 1} were swapped "
                                                           "in transit." if swapped else "")
                      + (f" {len(valid_flips)} bit(s) flipped in transit." if valid_flips else ""),
                      [_row(f"w{i}" if i <= len(words) else "checksum", w, "bad" if w != (words + [checksum])[i - 1]
                            else "", indent=1) for i, w in enumerate(rwords, 1)])]
    rsum = _ones_complement_sum(rwords, k, receiver, "running sum")
    ok = rsum == "1" * k
    receiver.append(_step("Is the sum all 1s?", "If nothing changed, data + checksum add up to all 1s (the complement is 0).",
                          [_row("sum", rsum, "good" if ok else "bad", indent=1),
                           _row("complement", invert(rsum), "good" if ok else "bad", indent=1)]))
    changed = received_tx != data + checksum
    if ok:
        verdict = {"status": "accept" if not changed else "undetected",
                   "text": "ACCEPT ✔ — the sum is all 1s." if not changed else
                   "ACCEPT ✔ — but the data WAS changed! The checksum cannot see this error."}
    else:
        verdict = {"status": "reject", "text": "REJECT ✘ — the sum is not all 1s, so an error is detected."}

    extra = {"word": k, "padding_bits": pad, "checksum": checksum, "checksum_hex": _hex_of(checksum),
             "swapped": list(swapped) if swapped else None}
    # cross-check with the real protocol (16-bit only) and compare against CRC32 on the same data
    if k == 16:
        extra["protocol_checksum16"] = f"{P.internet_checksum16(bits_to_bytes(data)):016b}"
        extra["matches_protocol"] = extra["protocol_checksum16"] == checksum
    if changed:
        a, b = bits_to_bytes(data), bits_to_bytes(received_tx[:len(data)])
        extra["crc_compare"] = {"sent_crc32": f"{P.crc32(a):08x}", "received_crc32": f"{P.crc32(b):08x}",
                                "crc_detects": P.crc32(a) != P.crc32(b), "checksum_detects": not ok}
    return {"kind": "checksum", "title": f"Internet checksum ({k}-bit words)",
            "params": {"input": text, "mode": mode, "word": k}, "data_bits": data,
            "transmitted": data + checksum, "received": received_tx, "flips": valid_flips,
            "segments": [{"name": "data", "start": 0, "end": len(data)},
                         {"name": "checksum", "start": len(data), "end": len(data) + k}],
            "sender": sender, "receiver": receiver, "verdict": verdict, "extra": extra,
            "preset": "Checksum fooled by reordering, CRC catches it"}


# ---------------------------------------------------------------------------
# 2) CRC — binary long division
# ---------------------------------------------------------------------------
def long_division(dividend, gen):
    """Modulo-2 long division. Returns (iterations, quotient, remainder) where each iteration is
    (offset, current_bits, subtrahend, result_bits, quotient_bit)."""
    g, n = len(gen), len(dividend)
    if n < g:                                   # shorter than the generator: nothing to divide, it IS the remainder
        return [], "", dividend.rjust(g - 1, "0")
    cur, its, quotient, remainder = dividend[:g], [], "", ""
    for i in range(n - g + 1):
        q = cur[0]
        sub = gen if q == "1" else "0" * g
        res = xor_bits(cur, sub)
        its.append((i, cur, sub, res, q))
        quotient += q
        if i + g < n:
            cur = res[1:] + dividend[i + g]
        else:
            remainder = res[1:]
    return its, quotient, remainder


def crc_bitwise(data_bits, gen):
    """Independent shift-register CRC (plain division, init 0) used to cross-check long_division."""
    r = len(gen) - 1
    reg = 0
    poly = int(gen, 2)
    for b in data_bits + "0" * r:
        reg = (reg << 1) | int(b)
        if reg >> r & 1:
            reg ^= poly
    return reg & ((1 << r) - 1)


def _division_steps(dividend, gen, group, collapsed=False, verb="Divide"):
    its, quotient, remainder = long_division(dividend, gen)
    g = len(gen)
    steps = [_step(f"{verb} {dividend} by {gen}",
                   f"Binary long division with XOR (no borrows). Look at the leftmost bit of the {g}-bit window: "
                   f"1 → XOR with the generator {gen}; 0 → XOR with {'0' * g}. Drop the leading bit, bring down the next.",
                   [_row("quotient", quotient, "quot", indent=g + 3 + g - 1),
                    _row("", gen + " ) " + dividend, "head")], group, collapsed)]
    for i, cur, sub, res, q in its:
        steps.append(_step(f"Step {i + 1}", "", [
            _row("", cur, indent=i + g + 3, note=f"window {i + 1}: leading bit {q} → XOR with "
                 f"{'generator' if q == '1' else 'zeros'}"),
            _row("", sub, indent=i + g + 3, cls="gen" if q == "1" else "zero"),
            _row("", "-" * g, indent=i + g + 3)], group, collapsed))
    steps.append(_step("Remainder", f"No more bits to bring down. The remainder is {remainder}.",
                       [_row("remainder", remainder, "result", indent=g + 3 + len(dividend) - len(remainder),
                             hl=_ones(remainder, "result"))], group, collapsed))
    return steps, quotient, remainder


def _reflect_bytes(bits):
    return "".join(bits[i:i + 8][::-1] for i in range(0, len(bits), 8))


def crc32_by_division(data):
    """CRC-32 computed as plain polynomial division after the three standard tweaks
    (reflect input bytes, preset the register to all 1s, reflect + invert the result).
    Returns (crc_int, dividend, remainder, iterations)."""
    dividend = _reflect_bytes(bytes_to_bits(data)) + "0" * 32
    dividend = xor_bits(dividend[:32], "1" * 32) + dividend[32:]
    its, _, rem = long_division(dividend, CRC32_POLY_BITS)
    return int(invert(rem[::-1]), 2), dividend, rem, its


def _resolve_generator(generator):
    g = GENERATORS.get(str(generator).lower(), str(generator))
    if not re.fullmatch(r"1[01]+", g):
        raise ValueError("generator must be crc3 / crc4 / crc8 / crc32 or a binary string starting with 1")
    if len(g) > 33:
        raise ValueError("generator too long")
    return g


def solve_crc(text, mode="auto", generator="crc3", flips=()):
    bits, mode = parse_bits(text, mode)
    gen = _resolve_generator(generator)
    name = next((k for k, v in GENERATORS.items() if v == gen), "custom")
    if name == "crc32":
        return _solve_crc32(bits, text, mode, flips)
    if len(bits) > 96:
        raise ValueError("CRC long division is limited to 96 data bits in the Lab (use crc32 for longer data)")
    r = len(gen) - 1

    # ---- sender ----
    dividend = bits + "0" * r
    sender = [
        _step("Generator polynomial", f"Generator {gen} = {poly_str(gen)}  (degree r = {r}, so the CRC has {r} bits).",
              [_row("data", bits, note=poly_str(bits) if len(bits) <= 16 else ""), _row("generator", gen)]),
        _step(f"Append {r} zero{'s' if r > 1 else ''}", "Make room for the CRC by appending r zeros to the data.",
              [_row("data", bits), _row("+ zeros", "0" * r, indent=len(bits)), _row("dividend", dividend, "head")])]
    div_steps, quotient, rem = _division_steps(dividend, gen, "sender-division")
    sender += div_steps
    sender.append(_step("CRC = remainder → codeword",
                        "Replace the appended zeros by the remainder. Data + CRC is what we transmit.",
                        [_row("data", bits), _row("CRC", rem, "result", indent=len(bits), hl=_ones(rem, "result")),
                         _row("sent", bits + rem, "result")]))
    transmitted = bits + rem

    # ---- receiver ----
    received, valid_flips = _apply_flips(transmitted, flips)
    receiver = [_step("Received codeword", "The receiver divides the whole received codeword by the same generator."
                      + (f" {len(valid_flips)} bit(s) flipped in transit." if valid_flips else ""),
                      [_row("sent", transmitted), _row("received", received, "bad" if valid_flips else "",
                                                        hl=[[i, "bad"] for i in valid_flips])])]
    rsteps, _, rrem = _division_steps(received, gen, "receiver-division", verb="Divide")
    receiver += rsteps
    ok = set(rrem) <= {"0"}
    changed = received != transmitted
    receiver.append(_step("Remainder zero?", "Remainder 0…0 means the codeword is divisible by the generator.",
                          [_row("remainder", rrem, "good" if ok else "bad")]))
    if ok:
        verdict = {"status": "accept" if not changed else "undetected",
                   "text": "ACCEPT ✔ — remainder is zero." if not changed else
                   "ACCEPT ✔ — but the data WAS changed: the error pattern is a multiple of the generator (undetectable)."}
    else:
        verdict = {"status": "reject", "text": "REJECT ✘ — non-zero remainder: an error is detected."}
    extra = {"generator": gen, "generator_name": name, "polynomial": poly_str(gen), "crc": rem, "quotient": quotient,
             "bitwise_agrees": int(rem, 2) == crc_bitwise(bits, gen)}
    return {"kind": "crc", "title": f"CRC with generator {gen} ({poly_str(gen)})",
            "params": {"input": text, "mode": mode, "generator": name if name != "custom" else gen},
            "data_bits": bits, "transmitted": transmitted, "received": received, "flips": valid_flips,
            "segments": [{"name": "data", "start": 0, "end": len(bits)},
                         {"name": "CRC", "start": len(bits), "end": len(bits) + r}],
            "sender": sender, "receiver": receiver, "verdict": verdict, "extra": extra,
            "preset": "Noise (CRC catches it, resend)"}


def _solve_crc32(bits, text, mode, flips):
    pad = -len(bits) % 8
    data = bits_to_bytes(bits)
    ref_crc, dividend, rem, its = crc32_by_division(data)
    real, proto = zlib.crc32(data) & 0xFFFFFFFF, P.crc32(data)
    show_div = len(data) * 8 + 32 <= 112
    sender = [
        _step("CRC-32 generator", f"CRC-32 (IEEE 802.3, the one in our protocol) uses the 33-bit generator "
              f"0x104C11DB7 = {poly_str(CRC32_POLY_BITS)[:60]}…", [_row("generator", CRC32_POLY_BITS)]),
        _step("Prepare the message", "Real CRC-32 = plain long division plus three conventions: ① reflect the bits of each "
              "byte, ② invert the first 32 bits (register preset to all 1s), ③ append 32 zeros."
              + (f" (the data was padded with {pad} zero bits to whole bytes)" if pad else ""),
              [_row("data", bytes_to_bits(data)), _row("① reflected", _reflect_bytes(bytes_to_bits(data))),
               _row("② + ③", dividend, "head")])]
    if show_div:
        div_steps, _, _ = _division_steps(dividend, CRC32_POLY_BITS, "crc32-division", collapsed=True)
        sender += div_steps
    else:
        sender.append(_step("Long division skipped", "The dividend is too long to print; the remainder is computed the "
                            "same way.", [_row("dividend", f"{len(dividend)} bits")]))
    sender.append(_step("Finish: reflect + invert", "④ reflect the 32-bit remainder, ⑤ invert it (XOR with all 1s).",
                        [_row("remainder", rem), _row("④ reflected", rem[::-1]), _row("⑤ inverted → CRC-32",
                                                                                   f"{ref_crc:032b}", "result"),
                         _row("hex", f"0x{ref_crc:08x}", "result")]))
    sender.append(_step("Check against the real implementation",
                        "The same message through zlib.crc32 and through protocol.crc32:",
                        [_row("long division", f"0x{ref_crc:08x}"), _row("zlib.crc32", f"0x{real:08x}"),
                         _row("protocol.crc32", f"0x{proto:08x}"),
                         _row("", "✔ all three agree" if ref_crc == real == proto else "✘ MISMATCH", "good"
                              if ref_crc == real == proto else "bad")]))
    crc_bits = f"{real:032b}"
    transmitted = bytes_to_bits(data) + crc_bits
    received, valid_flips = _apply_flips(transmitted, flips)
    rdata, rcrc = bits_to_bytes(received[:-32]), int(received[-32:], 2)
    rcomputed = zlib.crc32(rdata) & 0xFFFFFFFF
    ok = rcomputed == rcrc
    receiver = [
        _step("Received message + CRC", (f"{len(valid_flips)} bit(s) flipped in transit. " if valid_flips else "")
              + "The receiver recomputes CRC-32 over the received data and compares.",
              [_row("received CRC", f"{rcrc:032b}", note=f"0x{rcrc:08x}"),
               _row("recomputed", f"{rcomputed:032b}", "good" if ok else "bad", note=f"0x{rcomputed:08x}")])]
    changed = received != transmitted
    verdict = ({"status": "accept" if not changed else "undetected", "text": "ACCEPT ✔ — CRCs match."} if ok else
               {"status": "reject", "text": "REJECT ✘ — CRC mismatch: an error is detected."})
    return {"kind": "crc", "title": "CRC-32 (the protocol's real check)",
            "params": {"input": text, "mode": mode, "generator": "crc32"},
            "data_bits": bytes_to_bits(data), "transmitted": transmitted, "received": received, "flips": valid_flips,
            "segments": [{"name": "data", "start": 0, "end": len(data) * 8},
                         {"name": "CRC", "start": len(data) * 8, "end": len(data) * 8 + 32}],
            "sender": sender, "receiver": receiver, "verdict": verdict,
            "extra": {"generator": CRC32_POLY_BITS, "generator_name": "crc32", "crc": crc_bits, "crc_hex": f"0x{real:08x}",
                      "matches_zlib": ref_crc == real, "matches_protocol": proto == real, "padding_bits": pad},
            "preset": "Noise (CRC catches it, resend)"}


# ---------------------------------------------------------------------------
# 3) Hamming code
# ---------------------------------------------------------------------------
def hamming_layout(m):
    """Number of parity bits r (2^r >= m + r + 1) and the parity / data positions."""
    r = 1
    while 2 ** r < m + r + 1:
        r += 1
    n = m + r
    parity = [2 ** i for i in range(r)]
    return r, n, parity, [p for p in range(1, n + 1) if p not in parity]


def hamming_encode_bits(data, parity="even"):
    """Return the codeword as a list indexed by position (index 0 unused)."""
    r, n, ppos, dpos = hamming_layout(len(data))
    cw = [0] * (n + 1)
    for p, b in zip(dpos, data):
        cw[p] = int(b)
    for p in ppos:
        x = 0
        for q in range(1, n + 1):
            if q & p and q != p:
                x ^= cw[q]
        cw[p] = x ^ (1 if parity == "odd" else 0)
    return cw


def hamming_syndrome(cw_bits, parity="even"):
    """cw_bits: string of n bits (position 1 first). Returns (syndrome, [check details])."""
    n = len(cw_bits)
    r = 1
    while 2 ** r < n + 1:
        r += 1
    checks, syndrome = [], 0
    for i in range(r):
        p = 2 ** i
        pos = [q for q in range(1, n + 1) if q & p]
        x = 0
        for q in pos:
            x ^= int(cw_bits[q - 1])
        c = x ^ (1 if parity == "odd" else 0)
        checks.append({"p": p, "positions": pos, "xor": x, "c": c})
        syndrome |= c << i
    return syndrome, checks


GROUP_CLS = ["g1", "g2", "g3", "g4", "g5"]
W = 4          # character width of one table cell


def _cells(values):
    return "".join(str(v).ljust(W) for v in values)


def _cell_hl(indices, cls):
    out = []
    for c in indices:
        out += [[c * W + k, cls] for k in range(W - 1)]
    return out


def solve_hamming(text, mode="auto", scheme="74", parity="even", flips=()):
    bits, mode = parse_bits(text, mode)
    parity = "odd" if parity == "odd" else "even"
    if scheme == "74":
        if len(bits) != 4:
            raise ValueError("Hamming(7,4) takes exactly 4 data bits — use the general mode for other lengths")
    elif len(bits) > 26:
        raise ValueError("general Hamming mode is limited to 26 data bits in the Lab")
    m = len(bits)
    r, n, ppos, dpos = hamming_layout(m)
    cw = hamming_encode_bits(bits, parity)
    roles = [f"P{p}" if p in ppos else f"D{dpos.index(p) + 1}" for p in range(1, n + 1)]
    pos_row = _cells(range(1, n + 1))
    role_row = _cells(roles)
    placed = _cells(["?" if p in ppos else bits[dpos.index(p)] for p in range(1, n + 1)])
    ineq = [f"r={i}: 2^{i} = {2 ** i}  {'≥' if 2 ** i >= m + i + 1 else '<'}  m + r + 1 = {m + i + 1}"
            f"  {'✔' if 2 ** i >= m + i + 1 else '✘'}" for i in range(1, r + 1)]

    sender = [
        _step("Number of parity bits", f"We have m = {m} data bits. We need the smallest r with 2^r ≥ m + r + 1.",
              [_row("", line, "good" if "✔" in line else "") for line in ineq] +
              [_row("", f"→ r = {r} parity bits, codeword length n = m + r = {n}  →  Hamming({n},{m})", "result")]),
        _step("Position table", "Number the positions 1…n. Positions that are powers of 2 (1, 2, 4, 8…) hold the parity bits; "
              "the data bits fill the other positions from left to right.",
              [_row("position", pos_row), _row("role", role_row), _row("bit", placed)])]
    cwb = ["?" if p in ppos else str(cw[p]) for p in range(1, n + 1)]
    for gi, p in enumerate(ppos):
        cover = [q for q in range(1, n + 1) if q & p]
        others = [q for q in cover if q != p]
        vals = " ⊕ ".join([f"P{p}"] + [str(cw[q]) for q in others])
        x = 0
        for q in others:
            x ^= cw[q]
        cwb[p - 1] = str(cw[p])
        sender.append(_step(
            f"Parity bit P{p}",
            f"P{p} covers every position whose binary representation has the {p}-bit set: "
            f"{', '.join(map(str, cover))}. {parity.capitalize()} parity: make the XOR of the covered bits "
            f"{'0' if parity == 'even' else '1'}.",
            [_row("position", pos_row), _row("covered", _cells([("•" if q & p else "") for q in range(1, n + 1)]),
                                              hl=_cell_hl([q - 1 for q in cover], GROUP_CLS[gi % 5])),
             _row("bit", _cells(cwb), hl=_cell_hl([q - 1 for q in cover], GROUP_CLS[gi % 5])),
             _row("", f"{vals} = {0 if parity == 'even' else 1}  →  P{p} = {cw[p]}", "result")]))
    word = "".join(str(cw[p]) for p in range(1, n + 1))
    sender.append(_step("Codeword", "All parity bits are filled in. This is what we transmit.",
                        [_row("position", pos_row), _row("role", role_row),
                         _row("codeword", _cells(list(word)), "result",
                              hl=_cell_hl([p - 1 for p in ppos], "parity")), _row("sent", word, "result")]))

    received, valid_flips = _apply_flips(word, flips)
    syndrome, checks = hamming_syndrome(received, parity)
    receiver = [_step("Received codeword", (f"{len(valid_flips)} bit(s) flipped in transit (positions "
                                            f"{', '.join(str(i + 1) for i in valid_flips)}). " if valid_flips else "")
                      + "The receiver recomputes each parity check over the positions it covers (including the parity bit itself).",
                      [_row("position", pos_row), _row("sent", _cells(list(word))),
                       _row("received", _cells(list(received)), "bad" if valid_flips else "",
                            hl=_cell_hl([i for i in valid_flips], "bad"))])]
    for gi, c in enumerate(checks):
        vals = " ⊕ ".join(received[q - 1] for q in c["positions"])
        receiver.append(_step(
            f"Check c{c['p']}", f"c{c['p']} covers positions {', '.join(map(str, c['positions']))}.",
            [_row("covered", _cells([("•" if q & c["p"] else "") for q in range(1, n + 1)]),
                  hl=_cell_hl([q - 1 for q in c["positions"]], GROUP_CLS[gi % 5])),
             _row("", f"c{c['p']} = {vals} = {c['xor']}" + (f"  (odd parity: expect 1 → c = {c['c']})" if parity == "odd" else ""),
                  "good" if c["c"] == 0 else "bad")]))
    sbits = "".join(str(c["c"]) for c in reversed(checks))
    names = " ".join(f"c{c['p']}" for c in reversed(checks))
    receiver.append(_step("Syndrome", "Write the checks as a binary number (largest check on the left). "
                          "Its value is the position of the flipped bit; 0 means no error.",
                          [_row("", f"{names} = {sbits}₂ = {syndrome}", "result" if syndrome else "good")]))

    fixed, status = list(received), None
    if syndrome == 0:
        receiver.append(_step("No error detected", "Syndrome 0 → every parity check passes.", []))
    elif syndrome > n:
        receiver.append(_step("Uncorrectable", f"Syndrome {syndrome} points beyond the {n}-bit codeword: "
                              "more than one bit is wrong, and this is detected but cannot be corrected.", []))
    else:
        fixed[syndrome - 1] = "1" if fixed[syndrome - 1] == "0" else "0"
        receiver.append(_step(f"Flip bit {syndrome} back", f"The syndrome says position {syndrome} is wrong, so flip it.",
                              [_row("position", pos_row), _row("received", _cells(list(received))),
                               _row("corrected", _cells(fixed), "result", hl=_cell_hl([syndrome - 1], "result"))]))
    fixed_s = "".join(fixed)
    extracted = "".join(fixed_s[p - 1] for p in dpos)
    receiver.append(_step("Extract the data bits", "Read the data positions of the (corrected) codeword.",
                          [_row("data", extracted, "good" if extracted == bits else "bad"),
                           _row("original", bits)]))
    if not valid_flips:
        verdict = {"status": "accept", "text": "ACCEPT ✔ — syndrome 0, no error."}
    elif extracted == bits and syndrome:
        verdict = {"status": "corrected", "text": f"Error corrected at position {syndrome} ✔ — data recovered."}
    elif syndrome == 0:
        verdict = {"status": "undetected", "text": "Syndrome 0 although bits were flipped: the error pattern is itself a "
                   "valid codeword — Hamming cannot see it."}
    elif syndrome > n:
        verdict = {"status": "reject", "text": "Error detected but NOT correctable (syndrome outside the codeword)."}
    else:
        verdict = {"status": "miscorrected",
                   "text": f"WRONG correction ✘ — with {len(valid_flips)} flipped bits the syndrome ({syndrome}) points at "
                           "a bit that was fine, so Hamming 'fixes' the wrong bit. A CRC / checksum on the data "
                           "is still needed to catch this."}
    extra = {"m": m, "r": r, "n": n, "parity": parity, "syndrome": syndrome, "parity_positions": ppos,
             "data_positions": dpos, "codeword": word, "corrected_data": extracted}
    if scheme == "74" and m == 4:
        nib = int(bits, 2)
        proto_cw = f"{P.hamming74_encode_nibble(nib):07b}"
        got_nib, got_pos = P.hamming74_decode_byte(int(received, 2))
        extra["matches_protocol"] = (parity == "even" and proto_cw == word)
        extra["protocol_decode"] = {"nibble": f"{got_nib:04b}", "position": got_pos,
                                    "agrees": parity != "even" or (got_pos == (syndrome if syndrome <= n else 0)
                                                                   and f"{got_nib:04b}" == extracted)}
    return {"kind": "hamming", "title": f"Hamming({n},{m}) — {parity} parity",
            "params": {"input": text, "mode": mode, "scheme": scheme, "parity": parity},
            "data_bits": bits, "transmitted": word, "received": received, "flips": valid_flips,
            "segments": [{"name": ("P" if p in ppos else "D"), "start": p - 1, "end": p} for p in range(1, n + 1)],
            "sender": sender, "receiver": receiver, "verdict": verdict, "extra": extra,
            "preset": "Noise + Hamming (self-repair)"}


# ---------------------------------------------------------------------------
# dispatch, examples, plain-text rendering
# ---------------------------------------------------------------------------
def solve(kind, **p):
    if kind == "checksum":
        return solve_checksum(p.get("input", ""), p.get("mode", "auto"), p.get("word", 8), p.get("flips", ()),
                              p.get("swap"))
    if kind == "crc":
        return solve_crc(p.get("input", ""), p.get("mode", "auto"), p.get("generator", "crc3"), p.get("flips", ()))
    if kind == "hamming":
        return solve_hamming(p.get("input", ""), p.get("mode", "auto"), p.get("scheme", "74"),
                             p.get("parity", "even"), p.get("flips", ()))
    raise ValueError(f"unknown solver {kind!r}")


def example(kind, which="textbook", seed=None):
    """Input parameters for the 'Textbook example' / 'Random example' buttons."""
    rng = random.Random(seed)
    if which == "textbook":
        return {"checksum": {"input": "10110011 01101100", "mode": "bin", "word": 8},
                "crc": {"input": "11010011101100", "mode": "bin", "generator": "crc3"},
                "hamming": {"input": "1011", "mode": "bin", "scheme": "74", "parity": "even"}}[kind]
    rb = lambda n: "".join(rng.choice("01") for _ in range(n))                     # noqa: E731
    if kind == "checksum":
        k = rng.choice([8, 8, 16])
        return {"input": " ".join(rb(k) for _ in range(rng.randint(2, 4))), "mode": "bin", "word": k}
    if kind == "crc":
        return {"input": rb(rng.randint(8, 16)), "mode": "bin", "generator": rng.choice(["crc3", "crc4", "crc8"])}
    return {"input": rb(4), "mode": "bin", "scheme": "74", "parity": "even"}


def render_text(solution, parts=("sender",)):
    """Plain-text rendering of a solution (used to build the docs, so they never contain hand-typed numbers)."""
    lines = []
    for part in parts:
        steps = [s for s in solution[part] if not s.get("collapsed")]
        i = 0
        while i < len(steps):
            j = i + 1                                   # a "block" = consecutive steps of one group (e.g. a long division)
            while j < len(steps) and steps[i].get("group") and steps[j].get("group") == steps[i]["group"]:
                j += 1
            block = steps[i:j]
            lw = max([len(r["label"]) for s in block for r in s["rows"]] + [0])
            for s in block:
                if s["title"] and not (s.get("group") and s["title"].startswith(("Step ", "Remainder"))):
                    lines.append(s["title"])
                    if s["text"]:
                        lines.append(f"  # {s['text']}")
                for r in s["rows"]:
                    note = f"   <- {r['note']}" if r["note"] else ""
                    lines.append(f"  {r['label'].ljust(lw)} {' ' * r['indent']}{r['bits']}{note}".rstrip())
            i = j
    return chr(10).join(lines)
