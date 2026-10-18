# Demo script (5 minutes)

## Setup (before the demo)

1. Open a terminal and run `python run_all.py` (or `start.bat`).
2. Open http://localhost:5050 in a browser.
3. Confirm the status shows "System ready" (green dot in the header).

## Objectives (4 minutes)

### O1: Does the file arrive intact? (1 minute)

Press **1** or click the first objective.

- The proxy is set to "clean" mode (no errors).
- Watch: all chunks travel from Client to Server, turning green on arrival.
- Result card: **VERIFIED**. SHA-256 hash matches.
- Point to make: the protocol works, TCP delivers chunks in order, SHA-256 confirms the file.

### O2: Does the checksum detect damaged chunks? (1 minute)

Press **2**.

- The proxy flips random bits in 30% of chunks.
- Watch: some chunks turn amber (damaged), then red (NACK), then re-sent.
- "What is happening" shows: "Server recomputes the checksum of chunk N: mismatch, sends NACK, chunk is re-sent."
- Result card: **VERIFIED** after retransmissions.
- Point to make: the 16-bit checksum detects corruption, NACK triggers retransmission.

### O3: Can Hamming fix errors without retransmission? (1 minute)

Press **3**.

- Same noise, but Hamming(7,4) FEC is enabled.
- Watch: chunks turn blue (corrected by Hamming), no red (no NACKs).
- Result card: **VERIFIED**, 0 retransmissions.
- Point to make: FEC repairs 1-bit errors in place, saving round trips.

### O4: Checksum vs CRC32: which detects more? (1 minute)

Press **4**.

- The proxy swaps two 16-bit words in corrupted chunks.
- Watch: the checksum does not detect the swap (the sum is unchanged).
- Result card: **REJECTED**. File is quarantined.
- Point to make: the checksum is order-insensitive, CRC32 catches this. Show the "How it works" tab comparison table.

## Extension (1 minute, if time allows)

Switch to the "Beyond the brief" tab and run:

1. **Attack without HMAC**: the proxy forges chunks and recomputes the checksum. The server accepts them. SHA-256 mismatch: file is corrupted.
2. **Attack with HMAC**: same attack, but every forged chunk is rejected (HMAC cannot be recomputed without the key). File is verified.

Point to make: a checksum is not authentication. Only a keyed MAC stops forgery.

## Questions to expect

- Why not just use TCP's checksum? (It is only 16 bits, and only covers one hop.)
- Why does Hamming double the data size? (Each 4-bit nibble becomes 7 bits.)
- Can Hamming fix 2-bit errors? (No, it miscorrects. The checksum/CRC catches it.)
- What does HMAC add over CRC? (A secret key, so the attacker cannot recompute it.)
