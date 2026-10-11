# 02 · Chunking, framing and stop-and-wait ARQ

## In one line
The file is cut into numbered chunks; the sender waits for an acknowledgement (ACK) after each one and re-sends the chunk if the receiver says NACK or stays silent.

## The problem it solves (real-life example)
Reading a long number to a friend on a bad phone line: you say a few digits, they repeat them back, and if they got them wrong or the line dropped you say them again. Chunking makes each "sentence" small enough to repeat cheaply; sequence numbers make sure nothing is skipped or duplicated.

## How it works

**Frame header (17 bytes, big-endian)**

| Field | Bytes | Meaning |
|---|---|---|
| MAGIC | 2 | `"FT"` — marks the start of a frame |
| VER | 1 | protocol version (2; version-1 frames are still accepted) |
| TYPE | 1 | 1 META · 2 DATA · 3 ACK · 4 NACK · 5 DONE · 6 RESULT · 7 ERR |
| FLAGS | 1 | bit0 HMAC present · bit1 Hamming-encoded payload · bit2 checksum-16 instead of CRC32 |
| SEQ | 4 | chunk number — a plain counter, **not** a file offset |
| LEN | 4 | payload bytes on the wire |
| CHECK | 4 | CRC32 (or the 16-bit checksum in the low half) of the plaintext chunk |

**Conversation (one DATA chunk fails once)**

```
Client                                      Server
  │── META {name,size,sha256} ───────────────▶│  stage a new file
  │◀───────────────────────────── ACK 0 ──────│
  │── DATA seq=0 ────────────────────────────▶│  verify → write → ACK
  │◀───────────────────────────── ACK 0 ──────│
  │── DATA seq=1 ────────────────────────────▶│  CHECK mismatch
  │◀────────────────── NACK 1 "crc_fail" ─────│
  │── DATA seq=1 (retransmit) ───────────────▶│
  │◀───────────────────────────── ACK 1 ──────│
  │── DONE ──────────────────────────────────▶│  SHA-256 of the whole file
  │◀──────────── RESULT {match, expected, got} │
```

1. **Chunking** — the client slices `blob[offset : offset + chunk_size]`. Because SEQ is just a counter, the chunk size may change mid-transfer (Auto Defense does this; see doc 08): the server simply appends each accepted chunk in order.
2. **Stop-and-wait** — one chunk in flight. ACK → next chunk. NACK or timeout → same chunk again (up to `MAX_RETRIES`, default 8, then the transfer gives up).
3. **Duplicates** — if an ACK is delayed, the client times out and re-sends a chunk the server already has. The server sees `seq < expected`, does not write it again, and just re-ACKs. The client ignores a late ACK for an earlier chunk.
4. **Throughput ≈ chunk size / round-trip time**, because only one chunk is ever in flight — which is why larger chunks help and why each error costs a whole round trip.

## Where it is in our code
| What | File · function |
|---|---|
| slicing, retry loop, stale-ACK skipping | `client.py` · `_run_attempt` → `exchange` |
| duplicate handling, ACK/NACK replies | `server.py` · `FileServer._handle` |
| header pack/unpack, `FLAGS` | `protocol.py` · `pack_header`, `read_frame` |

## Live demo — exact steps
* Dashboard → Advanced → preset **2 Noisy link** (or guided step 2).
* **Expected:** some squares turn red (damaged), then amber ("sent again") once they arrive clean; the *Retransmits* tile counts them; verdict **VERIFIED**.
* CLI: `python proxy.py --mode noise --rate 0.2` then `python client.py sample_files/sample.txt` — the client log shows `DATA 12 NACK (crc_fail) -> retransmit #1`.
* Frame loss: `python proxy.py --loss 0.05` → `DATA 7 timeout (attempt 1) -> retransmit`.

## Wireshark evidence
Filter `tcp.port == 9000 && tcp.len > 0`. The same SEQ (bytes 5–8 of our header) appears **twice** after a NACK; ACK/NACK frames are small, type byte `03` / `04`, and a NACK payload reads `crc_fail`. Filter `frame contains "crc_fail"`.

## Linked test cases
`I4` noise → retransmits equal CRC failures · `I9` frame loss recovered by timeout · `I10` latency raises RTT · `I12` retry limit · `L4` smaller chunks mid-transfer still verify · `U5` frame round-trip.

## Limitations
* Stop-and-wait wastes the link while waiting; a sliding window (Go-Back-N, Selective Repeat) would keep several chunks in flight.
* One unlucky chunk can fail 8 times in a row on a terrible link — then the file is quarantined, not accepted.

## Likely viva questions
1. **What is stop-and-wait ARQ and its drawback?** Send one frame, wait for its ACK; re-send on NACK/timeout. Simple and correct, but throughput ≈ chunk/RTT, so the link idles while waiting.
2. **How do you avoid writing a chunk twice?** The server tracks the next expected SEQ; a chunk with a lower SEQ is a duplicate, so it is re-ACKed but not written.
3. **Why a sequence number if TCP already orders bytes?** TCP orders *bytes*, not our chunks: after a NACK we deliberately send the same chunk again, and SEQ lets the server tell a retransmission from new data.
