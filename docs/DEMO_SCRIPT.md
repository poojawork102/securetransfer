# Demo script (5 minutes)

## Setup

Open three terminals:

```
python server.py           (terminal 1)
python proxy.py            (terminal 2)
python dashboard/app.py    (terminal 3)
```

Open http://localhost:5050 in a browser. Confirm the status shows "System ready".

Or use `python run_all.py` to start everything at once.

## Objective 1: Clean transfer (1 min)

Press **1** or click the first objective.

- Proxy: clean mode (no errors).
- All chunks are sent once and ACKed.
- Result card: **VERIFIED**. SHA-256 hash matches.
- Point to make: the protocol works, TCP delivers chunks in order, SHA-256 confirms.

## Objective 2: Noise + checksum detection (1 min)

Press **2**.

- Proxy flips random bits in 30% of chunks.
- Some chunks are NACKed (checksum mismatch) and retransmitted.
- Result card: **VERIFIED** after retransmissions.
- Point to make: the 16-bit checksum catches random bit errors.

## Objective 3: Hamming forward error correction (1 min)

Press **3**.

- Same noise, but Hamming(7,4) FEC is enabled.
- All 1-bit errors are corrected in place. 0 retransmissions.
- Result card: **VERIFIED**, chunks show "corrected" status.
- Point to make: FEC repairs errors without retransmission.

## Objective 4: Checksum vs CRC32 (1 min)

Press **4**. This runs two transfers back-to-back:

1. First with checksum16 against word-swap corruption.
2. Then with CRC32 against the same corruption.

- Run 1 (checksum): word swap goes undetected, file is **REJECTED** (SHA-256 mismatch).
- Run 2 (CRC32): word swap is caught, chunks retransmitted, file is **VERIFIED**.
- Point to make: a checksum is order-insensitive, CRC32 detects what checksum misses.

## Calculator tab (30 sec)

Show the Calculator tab. Enter a binary string and solve checksum, CRC, or Hamming step-by-step, like an exam answer sheet.

## Questions to expect

- Why do we need a proxy? (TCP never corrupts data on localhost.)
- Why not just use TCP's checksum? (It is only 16 bits, and only covers one hop.)
- Why does Hamming double the data size? (Each 4-bit nibble becomes 7 bits.)
- Can Hamming fix 2-bit errors? (No, it miscorrects. The checksum/CRC catches it.)
- Why SHA-256 at the end? (End-to-end verification: catches anything the per-chunk check missed.)
