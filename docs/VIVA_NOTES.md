# Viva notes — likely questions

**Why add a checksum if TCP already has one?**
TCP's checksum is a 16-bit ones-complement sum. It is weak (misses swapped 16-bit words, some multi-bit errors) and only covers the transport segment. Data can still be corrupted in buffers, storage or middleboxes. Our application-level 16-bit Internet checksum (same algorithm but computed over the chunk payload) plus an end-to-end SHA-256 gives stronger assurance. CRC32 is even better at detecting errors and is available as a comparison.

**Why do we need a proxy at all?**
On localhost TCP never corrupts anything, so without a fault injector our checks would never fire. The proxy simulates a noisy channel, packet loss, latency and an attacker.

**CRC vs checksum vs hash vs HMAC?**
- Checksum / CRC: detect *accidental* errors. No secret, so anyone can recompute it.
- SHA-256: strong fingerprint of the whole file — still no secret.
- HMAC-SHA256: hash keyed with a secret. Without the key the attacker can't produce a valid tag → detects *deliberate* tampering (integrity + authenticity).

**How does Hamming(7,4) work?**
4 data bits + 3 parity bits. p1 covers positions 1,3,5,7; p2 covers 2,3,6,7; p3 covers 4,5,6,7. On receive, recompute the parities → the 3-bit syndrome is the position of the flipped bit (0 = no error). Flip it back. It corrects 1 error and can't reliably handle 2 (we mis-correct, and CRC catches it).

**Why compute CRC on the plaintext, not the encoded payload?**
So it verifies the *final* data after Hamming correction. If FEC mis-corrects a 2-bit error, CRC still catches it.

**What is stop-and-wait ARQ? Its drawback?**
Send one chunk and wait for its ACK before the next. Simple and correct, but throughput ≈ chunk_size / RTT — our latency graph shows throughput halving each time RTT doubles. Sliding window (Go-Back-N, Selective Repeat) keeps several chunks in flight.

**How do you handle a lost frame?**
The client's socket timeout fires, it retransmits. A late duplicate ACK is ignored by sequence number, and the server re-ACKs duplicate chunks without writing them twice.

**Why does FEC have 100 % overhead but no throughput loss in your graph?**
Our emulated link is latency-bound, not bandwidth-bound, so doubling bytes costs almost nothing while avoiding round trips. On a slow, bandwidth-limited link, FEC would cost throughput — it's a trade-off.

**Why UDP for telemetry?**
Fire-and-forget: if the dashboard isn't running, nothing breaks and the transfer isn't slowed down. Losing a telemetry packet only affects the visual.

**Is the data encrypted?**
No. HMAC gives integrity and authenticity, not confidentiality. Adding AES-GCM or running over TLS would encrypt it.

**What would you improve?**
Sliding window, key exchange instead of a pre-shared key, encryption, resumable transfers, stronger FEC (Reed-Solomon), multiple simultaneous clients in the dashboard.

---

## Auto Defense, quarantine, checksum mode, Numerical Lab

**What does "closed loop" mean in your project?**
The client monitors the last 20 transmissions, `adaptive.py` decides by fixed rules (Hamming on at ≥ 10 % check failures, smaller chunks if bursts beat Hamming, Hamming off after 30 clean transmissions, alert on any HMAC failure, give up after 8 failures on one chunk), the client acts, and the server's SHA-256 verifies the result — a mismatch quarantines the file and re-sends it with HMAC.

**Can a bad file ever end up in `received/`?**
No. Data is staged in `received/.incoming/` and moved to `received/` only after the whole-file SHA-256 matches. Mismatches and dropped connections go to `quarantine/` with a JSON sidecar.

**Why is the 16-bit checksum in the project if CRC32 is better?**
The brief names "checksum / Hamming". The checksum is the classic Internet checksum and is our default. Having both lets us demonstrate its weakness: swapping two 16-bit words leaves the sum unchanged, so the checksum is fooled and CRC32 catches it (Objective 4, tests C14-C18).

**Does Auto Defense stop the CRC-forging attacker by itself?**
Not before the end of the file: CRC-fooled chunks look perfect. The end-to-end SHA-256 catches it, the file is quarantined and Auto Defense re-sends with HMAC. If HMAC is on from the start, the first forged chunk raises an intrusion alert.

**Is the whole-file SHA-256 enough against an attacker?**
Only if the expected hash is trustworthy. It travels in the META frame, so an attacker who also rewrites META could make a tampered file match; with HMAC on, META is authenticated too.

**How do you know the Numerical Lab's answers are right?**
`numericals.py` is the only place the solutions are computed, and `tests/test_numericals.py` checks them against `protocol.py` and `zlib` (e.g. CRC-32 by long division equals `zlib.crc32`, CRC-8 of `123456789` is `0xF4`, Hamming codewords equal `hamming74_encode_nibble`).

**Why can the chunk size change mid-transfer?**
SEQ is a counter, not a file offset, and the server appends accepted chunks in order. A new size only applies from the next chunk, never to a retry (a delayed ACK could otherwise make us skip bytes).
