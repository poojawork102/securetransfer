# 05 · Hamming(7,4) — fixing a flipped bit without asking again

## In one line
Four data bits get three extra parity bits placed at positions 1, 2 and 4; if one bit flips in transit, the three parity checks combine into a number that is *the position of the bad bit*, so the receiver flips it back itself.

## The problem it solves (real-life example)
A satellite link where a re-send costs seconds: better to send a little redundancy up front and fix small errors on arrival (forward error correction, FEC) than to ask for the whole chunk again.

## How it works
Number the seven positions 1…7. Positions that are powers of two (1, 2, 4) are **parity bits**; positions 3, 5, 6, 7 carry the **data bits** d1…d4.

```
position   1   2   3   4   5   6   7
role      p1  p2  d1  p4  d2  d3  d4
```
Each parity bit covers the positions whose binary number contains its weight:

| parity | binary weight | covers positions |
|---|---|---|
| p1 | 001 | 1, 3, 5, 7 |
| p2 | 010 | 2, 3, 6, 7 |
| p4 | 100 | 4, 5, 6, 7 |

With **even parity** each group (including its own parity bit) must contain an even number of 1s. On receipt recompute the three checks c1, c2, c4; read `c4 c2 c1` as a binary number — the **syndrome**. Syndrome 0 = no error; otherwise it is the position to flip.

**Encoding a nibble by hand** (data `1011`; everything below is computed by `numericals.py`):

<!-- GEN:hamming74_sender -->
```text
Number of parity bits
  # We have m = 4 data bits. We need the smallest r with 2^r ≥ m + r + 1.
   r=1: 2^1 = 2  <  m + r + 1 = 6  ✘
   r=2: 2^2 = 4  <  m + r + 1 = 7  ✘
   r=3: 2^3 = 8  ≥  m + r + 1 = 8  ✔
   → r = 3 parity bits, codeword length n = m + r = 7  →  Hamming(7,4)
Position table
  # Number the positions 1…n. Positions that are powers of 2 (1, 2, 4, 8…) hold the parity bits; the data bits fill the other positions from left to right.
  position 1   2   3   4   5   6   7
  role     P1  P2  D1  P4  D2  D3  D4
  bit      ?   ?   1   ?   0   1   1
Parity bit P1
  # P1 covers every position whose binary representation has the 1-bit set: 1, 3, 5, 7. Even parity: make the XOR of the covered bits 0.
  position 1   2   3   4   5   6   7
  covered  •       •       •       •
  bit      0   ?   1   ?   0   1   1
           P1 ⊕ 1 ⊕ 0 ⊕ 1 = 0  →  P1 = 0
Parity bit P2
  # P2 covers every position whose binary representation has the 2-bit set: 2, 3, 6, 7. Even parity: make the XOR of the covered bits 0.
  position 1   2   3   4   5   6   7
  covered      •   •           •   •
  bit      0   1   1   ?   0   1   1
           P2 ⊕ 1 ⊕ 1 ⊕ 1 = 0  →  P2 = 1
Parity bit P4
  # P4 covers every position whose binary representation has the 4-bit set: 4, 5, 6, 7. Even parity: make the XOR of the covered bits 0.
  position 1   2   3   4   5   6   7
  covered              •   •   •   •
  bit      0   1   1   0   0   1   1
           P4 ⊕ 0 ⊕ 1 ⊕ 1 = 0  →  P4 = 0
Codeword
  # All parity bits are filled in. This is what we transmit.
  position 1   2   3   4   5   6   7
  role     P1  P2  D1  P4  D2  D3  D4
  codeword 0   1   1   0   0   1   1
  sent     0110011
```
<!-- /GEN -->

**Flip a bit, compute the syndrome, correct it** (bit 6 flipped in transit):

<!-- GEN:hamming74_receiver_flip -->
```text
Received codeword
  # 1 bit(s) flipped in transit (positions 6). The receiver recomputes each parity check over the positions it covers (including the parity bit itself).
  position 1   2   3   4   5   6   7
  sent     0   1   1   0   0   1   1
  received 0   1   1   0   0   0   1
Check c1
  # c1 covers positions 1, 3, 5, 7.
  covered •       •       •       •
          c1 = 0 ⊕ 1 ⊕ 0 ⊕ 1 = 0
Check c2
  # c2 covers positions 2, 3, 6, 7.
  covered     •   •           •   •
          c2 = 1 ⊕ 1 ⊕ 0 ⊕ 1 = 1
Check c4
  # c4 covers positions 4, 5, 6, 7.
  covered             •   •   •   •
          c4 = 0 ⊕ 0 ⊕ 0 ⊕ 1 = 1
Syndrome
  # Write the checks as a binary number (largest check on the left). Its value is the position of the flipped bit; 0 means no error.
   c4 c2 c1 = 110₂ = 6
Flip bit 6 back
  # The syndrome says position 6 is wrong, so flip it.
  position  1   2   3   4   5   6   7
  received  0   1   1   0   0   0   1
  corrected 0   1   1   0   0   1   1
Extract the data bits
  # Read the data positions of the (corrected) codeword.
  data     1011
  original 1011
=> Error corrected at position 6 ✔ — data recovered.
```
<!-- /GEN -->

**Why two errors fail** — Hamming(7,4) has minimum distance 3: it corrects 1 error and detects *some* 2-error patterns, but the syndrome of two flips points at a *third*, innocent position, and we "correct" the wrong bit:

<!-- GEN:hamming74_two_flips -->
```text
sent     0110011
received 0010001   (positions 2 and 6 flipped)
syndrome = 4  -> flips position 4
decoded data = 1001  (original was 1011)
=> WRONG correction ✘ — with 2 flipped bits the syndrome (4) points at a bit that was fine, so Hamming 'fixes' the wrong bit. A CRC / checksum on the data is still needed to catch this.
```
<!-- /GEN -->

That is exactly why the protocol computes the CRC32 (or checksum) **after** Hamming decoding: the mis-corrected data fails the check and the chunk is re-sent.

All sixteen codewords as our code generates them (`protocol.hamming74_encode_nibble`):

<!-- GEN:hamming74_table -->
```text
nibble  codeword (p1 p2 d1 p3 d2 d3 d4)   byte on wire
0000    0 0 0 0 0 0 0                      0x00
0001    1 1 0 1 0 0 1                      0x69
0010    0 1 0 1 0 1 0                      0x2a
0011    1 0 0 0 0 1 1                      0x43
0100    1 0 0 1 1 0 0                      0x4c
0101    0 1 0 0 1 0 1                      0x25
0110    1 1 0 0 1 1 0                      0x66
0111    0 0 0 1 1 1 1                      0x0f
1000    1 1 1 0 0 0 0                      0x70
1001    0 0 1 1 0 0 1                      0x19
1010    1 0 1 1 0 1 0                      0x5a
1011    0 1 1 0 0 1 1                      0x33
1100    0 1 1 1 1 0 0                      0x3c
1101    1 0 1 0 1 0 1                      0x55
1110    0 0 1 0 1 1 0                      0x16
1111    1 1 1 1 1 1 1                      0x7f
```
<!-- /GEN -->

**In our protocol** each data byte becomes two codewords (high nibble, low nibble), each stored in one byte, so the payload doubles in size — **100 % overhead** — in return for fewer round trips. The `proxy` puts all flips of a "burst" into one 7-bit block, so 1 bit is repairable and 2+ bits are not.

## Where it is in our code
| What | File · function |
|---|---|
| encode / decode one nibble, syndrome | `protocol.py` · `hamming74_encode_nibble`, `hamming74_decode_byte` |
| whole payload at C speed (lookup tables) | `protocol.py` · `hamming_encode`, `hamming_decode` |
| *where* it fixed something (for the chunk inspector) | `protocol.py` · `hamming_fix_details` |
| the general (n, m) version for the Lab | `numericals.py` · `hamming_layout`, `solve_hamming` |

## Live demo — exact steps
* Dashboard → Advanced → preset **3 Noise + Hamming** (or guided step 3).
* **Expected:** blue squares ("self-repaired"), *Bits fixed* climbs, **0 retransmits**, verdict **VERIFIED · SELF-HEALED**.
* Click a blue square: the inspector says e.g. *"Bit 5 of byte 734 was flipped in transit → Hamming syndrome 010₂ = 2 → corrected"*, and **Solve in the Numerical Lab → Hamming** loads that nibble.
* CLI: `python proxy.py --mode noise --rate 0.2 --bits 1` then `python client.py sample_files/sample.txt --fec`. With `--bits 3` the repairs fail and CRC falls back to a re-send.

## Wireshark evidence
FLAGS byte (offset 4) = `02`; LEN (offsets 9–12) is exactly 2× the data size; every payload byte is ≤ `0x7f` (only 7 of the 8 bits are used).

## Linked test cases
`U1` round-trip all bytes · `U2` every one of the 7 bit positions corrected · `U3` one error in every codeword · `U4` 2-bit burst caught by CRC · `U7` frame with FEC repairs a flip · `I5` noise → 0 retransmits · `I6` 3-bit burst falls back to re-send · `C13` fix details report the syndrome · `N18`, `N22`, `N23`, `N24` Lab equals the protocol · `N19` general (12,8) code.

## Limitations
Corrects one bit per 7-bit block; two flips are mis-corrected; +100 % bytes; no protection against a deliberate attacker (anyone can re-encode).

## Likely viva questions
1. **Why are the parity bits at positions 1, 2, 4?** Because each position's binary number then tells exactly which parity bits cover it, so the syndrome equals the error position.
2. **How many parity bits for *m* data bits?** The smallest *r* with 2^r ≥ m + r + 1 — for 4 data bits r = 3, for 8 data bits r = 4 (a (12,8) code).
3. **What happens with a 2-bit error?** The syndrome points at a wrong position and we flip an innocent bit; the CRC computed on the corrected data then fails and the chunk is re-sent.
