# Protocol design

## Frame format

17-byte fixed header, big-endian:

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 2 | MAGIC | ASCII "FT" (0x46 0x54) |
| 2 | 1 | VER | Protocol version (2) |
| 3 | 1 | TYPE | 1=META, 2=DATA, 3=ACK, 4=NACK, 5=DONE, 6=RESULT, 7=ERR |
| 4 | 1 | FLAGS | bit0=HMAC, bit1=Hamming FEC, bit2=checksum16 (else CRC32) |
| 5 | 4 | SEQ | Chunk sequence number (0-based) |
| 9 | 4 | LEN | Payload length in bytes |
| 13 | 4 | CHECK | 16-bit checksum (zero-padded to 4 bytes) or CRC32 |

Optional fields after the header:
- HMAC (32 bytes): HMAC-SHA256(key, header + plaintext), present if FLAGS bit0 is set.
- PAYLOAD (LEN bytes): the chunk data, or Hamming-encoded data if FLAGS bit1 is set.

## Exchange (stop-and-wait ARQ)

1. Client connects to the server (or proxy) over TCP.
2. Client sends a META frame with the filename, file size, chunk count, and SHA-256 hash.
3. Server replies with ACK 0.
4. For each chunk: client sends DATA, waits for ACK or NACK.
   - ACK: move to the next chunk.
   - NACK: retransmit the same chunk (up to MAX_RETRIES times).
   - Timeout: retransmit after the timeout expires.
5. Client sends DONE. Server compares SHA-256 of the received file.
6. Server replies with RESULT (match=true/false, expected hash, received hash).

## Error detection

**16-bit Internet checksum (default):** ones-complement sum of 16-bit words with
end-around carry, then complement. Defined in RFC 1071. Detects most single-bit errors
but misses word swaps and some multi-bit errors.

**CRC32:** polynomial division remainder using the standard CRC-32 generator.
Detects all 1, 2, and 3-bit errors and most burst errors. Used as a comparison.

## Error correction

**Hamming(7,4):** each byte is split into two 4-bit nibbles. Each nibble is encoded
into a 7-bit codeword with 3 parity bits at positions 1, 2, 4. The syndrome (XOR of
parity checks) gives the position of a single flipped bit, which is corrected.
Two bit errors in one codeword cause a miscorrection, caught by the checksum/CRC.

## Whole-file verification

After all chunks are received, the server computes SHA-256 of the assembled file and
compares it with the hash sent in the META frame. If they match, the file is moved to
`received/`. If not, the file is moved to `quarantine/` with a JSON sidecar.

## Authentication

HMAC-SHA256 uses a pre-shared key (ST_KEY environment variable) to authenticate each
frame. The attacker (proxy in MITM mode) can recompute the checksum or CRC after
modifying data, but cannot recompute the HMAC without the key.

## Auto Defense (closed-loop control)

The adaptive rules engine (`adaptive.py`) monitors error rates and adjusts:
- 10% or more check failures: enable Hamming FEC.
- Burst errors: halve the chunk size.
- Less than 2% failures over 30 chunks: disable FEC.
- Any HMAC failure: intrusion alert.
- SHA-256 mismatch: quarantine the file, retry with HMAC.
- 8 consecutive failures: give up.
