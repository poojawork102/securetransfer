# Viva notes -- likely questions

**Why add a checksum if TCP already has one?**
TCP's checksum is a 16-bit ones-complement sum. It is weak (misses swapped 16-bit words, some multi-bit errors) and only covers the transport segment. Data can still be corrupted in buffers, storage or middleboxes. Our application-level 16-bit Internet checksum (same algorithm but computed over the chunk payload) plus an end-to-end SHA-256 gives stronger assurance. CRC32 is even better at detecting errors and is available as a comparison.

**Why do we need a proxy at all?**
On localhost TCP never corrupts anything, so without a fault injector our checks would never fire. The proxy simulates a noisy channel, packet loss, and latency.

**CRC vs checksum vs hash?**
- Checksum / CRC: detect *accidental* errors. No secret, so anyone can recompute it.
- SHA-256: strong fingerprint of the whole file. Detects any change.
- CRC32 is stronger than checksum: polynomial-based, catches all 1,2,3-bit errors and bursts.

**How does Hamming(7,4) work?**
4 data bits + 3 parity bits. p1 covers positions 1,3,5,7; p2 covers 2,3,6,7; p3 covers 4,5,6,7. On receive, recompute the parities: the 3-bit syndrome is the position of the flipped bit (0 = no error). Flip it back. It corrects 1 error and can't reliably handle 2 (we mis-correct, and CRC catches it).

**Why compute CRC on the plaintext, not the encoded payload?**
So it verifies the *final* data after Hamming correction. If FEC mis-corrects a 2-bit error, CRC still catches it.

**What is stop-and-wait ARQ? Its drawback?**
Send one chunk and wait for its ACK before the next. Simple and correct, but throughput = chunk_size / RTT. Our latency graph shows throughput halving each time RTT doubles. Sliding window (Go-Back-N, Selective Repeat) would keep several chunks in flight.

**How do you handle a lost frame?**
The client's socket timeout fires, it retransmits. A late duplicate ACK is ignored by sequence number, and the server re-ACKs duplicate chunks without writing them twice.

**Why does FEC have 100% overhead but no throughput loss in your graph?**
Our emulated link is latency-bound, not bandwidth-bound, so doubling bytes costs almost nothing while avoiding round trips. On a slow, bandwidth-limited link, FEC would cost throughput.

**Why UDP for telemetry?**
Fire-and-forget: if the dashboard isn't running, nothing breaks and the transfer isn't slowed down. Losing a telemetry packet only affects the visual.

**Is the data encrypted?**
No. The project demonstrates error detection and correction, not confidentiality. Adding AES-GCM or running over TLS would encrypt it.

**What would you improve?**
Sliding window, encryption (TLS), resumable transfers, stronger FEC (Reed-Solomon), multiple simultaneous clients.

---

## Checksum mode and Numerical Lab

**Why is the 16-bit checksum in the project if CRC32 is better?**
The brief names "checksum / Hamming". The checksum is the classic Internet checksum and is our default. Having both lets us demonstrate its weakness: swapping two 16-bit words leaves the sum unchanged, so the checksum is fooled and CRC32 catches it (Objective 4).

**Can a bad file ever end up in `received/`?**
No. Data is staged in `received/.incoming/` and moved to `received/` only after the whole-file SHA-256 matches. A mismatch saves the file as `<name>.rejected`.

**How do you know the Numerical Lab's answers are right?**
`numericals.py` is the only place the solutions are computed, and `tests/test_numericals.py` checks them against `protocol.py` and `zlib` (e.g. CRC-32 by long division equals `zlib.crc32`, CRC-8 of `123456789` is `0xF4`, Hamming codewords equal `hamming74_encode_nibble`).
