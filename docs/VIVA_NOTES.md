# Viva notes — likely questions

**Why add a checksum if TCP already has one?**
TCP's checksum is a 16-bit ones'-complement sum. It's weak (misses swapped 16-bit words, some multi-bit errors) and only covers the transport segment. Data can still be corrupted in buffers, storage or middleboxes. CRC32 + an end-to-end SHA-256 gives much stronger, application-level assurance.

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
