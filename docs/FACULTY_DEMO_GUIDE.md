# SecureTransfer Lab — faculty demo guide

**CNL Mini Project · Topic 16: TCP-Based Client-Server File Transfer with Error Verification** · Group 4 (Pooja Lingwat, Saloni Muley, Aaditya Anekar, Pratham Shelke)

## The project in three lines
1. A **client** sends a file to a **server** over **TCP sockets**, cut into numbered chunks with stop-and-wait ARQ; every chunk is verified with an **error-detection mechanism** (16-bit Internet **checksum** or **CRC32**) and can be repaired by a **Hamming(7,4)** code.
2. A middle "network" (proxy) can damage the data, drop it, delay it, or act as a hacker who rewrites chunks *and* recomputes their CRC — showing that error detection is not security; **HMAC-SHA256** stops that.
3. A closed loop (**Auto Defense**) watches the link and switches protections on and off by itself, and the server only accepts a file whose **SHA-256** matches — everything else is **quarantined**.

## Architecture

```
                 TCP :8000                       TCP :9000
 ┌──────────┐   frames    ┌──────────────────┐   frames    ┌──────────┐
 │  CLIENT  │ ──────────▶ │ NETWORK (proxy)  │ ──────────▶ │  SERVER  │
 │client.py │ ◀────────── │ clean·noise·loss │ ◀────────── │server.py │
 │ Monitor →│  ACK/NACK   │ ·latency·hacker  │  ACK/NACK   │ verify → │
 │ Decide → │             └────────┬─────────┘             │ received/│
 │ Act      │   UDP telemetry :5555│  ▲ UDP control :5556  │quarantine│
 └────┬─────┘                      ▼  │                    └────┬─────┘
      └───────────────►  DASHBOARD (Flask + Socket.IO :5050) ◄───┘
                        3-D scene · chunk map · toasts · Numerical Lab
```

## Run it yourself (3 commands)
```bash
pip install -r requirements.txt
python run_all.py                      # starts server + network + dashboard and opens http://localhost:5050
python -m unittest discover -s tests   # all tests
```
No internet is needed. On the page, click **Run full demo** (≈ 3½ minutes, narrated on screen) or **Guided demo** (you step through).

## The six demo steps and what you should see

| # | Scenario | What we do | Expected on screen | Expected verdict |
|---|---|---|---|---|
| 1 | Normal network | send a file over a perfect link | all squares green, empty Auto Defense timeline | **VERIFIED** |
| 2 | Noisy network, CRC only | ~1 chunk in 5 gets a flipped bit | red squares → amber after re-send; Retransmits climbs | **VERIFIED** (damage caught by CRC32, chunks re-sent) |
| 3 | Noise + Hamming | same noise, Hamming on | blue squares, Bits fixed climbs, 0 re-sends | **VERIFIED · SELF-HEALED** |
| 4 | Hacker vs CRC (Auto Defense on) | hacker rewrites chunks and recomputes CRC | orange squares (CRC fooled); end-of-file hash fails → toast *File quarantined* → *Automatic retry* with HMAC → purple squares | **VERIFIED AFTER AUTO-RECOVERY**; **Show proof** shows the `HACKED!!` bytes |
| 5 | Hacker vs HMAC | every chunk carries an HMAC | purple squares, forged chunks rejected and re-sent; *INTRUSION ALERT* toast | **ATTACK BLOCKED** |
| 6 | Auto Defense, everything changes | 256 KB file; network goes noisy → bursty → clean → hostile | timeline: Hamming on → chunks halve → Hamming off → intrusion alert → retry with HMAC | **VERIFIED AFTER AUTO-RECOVERY** |

Bonus (Advanced view, preset **6**): *Checksum vs CRC* — the network swaps two 16-bit words in a chunk. The 16-bit checksum is **fooled** (verdict **FILE TAMPERED — CHECKSUM FOOLED**, file quarantined); CRC32 catches the same damage (**VERIFIED**).

Also try the **Numerical Lab** tab: solves checksum, CRC and Hamming step by step in 0/1, lets you flip any transmitted bit, and any chunk in a live transfer can be opened in it (click a square in the chunk map).

## Protection matrix

| Protection | Detects accidental errors? | Repairs them itself? | Detects deliberate tampering? |
|---|---|---|---|
| 16-bit checksum | ✅ most (misses some, e.g. swapped 16-bit words) | ❌ resend | ❌ forgeable |
| CRC32 | ✅ all 1–2 bit and burst ≤ 32 bits | ❌ resend | ❌ forgeable |
| Hamming(7,4) | ✅ 1 bit per 7-bit block (in correction mode, 2-bit errors get mis-corrected → CRC must catch them) | ✅ 1 bit per block | ❌ forgeable |
| HMAC-SHA256 | ✅ | ❌ resend | ✅ (needs the secret key) |
| SHA-256 (whole file) | ✅ | ❌ | ❌ alone; ✅ when the expected hash is authenticated |

## Where each faculty concept lives

| Concept | Code | Concept note | Live demo | Tests |
|---|---|---|---|---|
| TCP sockets, client–server | `client.py`, `server.py`, `proxy.py` | [01](concepts/01_tcp_client_server.md) | step 1 | I1–I3, I11 |
| Chunking, ARQ, framing | `client.py`, `protocol.py` | [02](concepts/02_chunking_and_arq.md) | step 2 | I4, I9, I10 |
| Checksum | `protocol.internet_checksum16` | [03](concepts/03_checksum.md) | preset 6 | C1–C18 |
| CRC | `protocol.crc32` | [04](concepts/04_crc32.md) | step 2 | U6, I4 |
| Hamming code | `protocol.hamming_*` | [05](concepts/05_hamming_code.md) | step 3 | U1–U4, I5, I6 |
| HMAC and the attack | `protocol.compute_hmac`, `proxy.forge_chunk` | [06](concepts/06_hmac_and_attack.md) | steps 4–5 | U9–U11, I7, I8 |
| SHA-256 and quarantine | `server.py` | [07](concepts/07_sha256_end_to_end.md) | step 4 | Q1–Q3 |
| Closed loop | `adaptive.py` | [08](concepts/08_closed_loop_auto_defense.md) | step 6 | R1–R20, L1–L8 |

Full mapping of every deliverable to code, test, demo step and evidence: [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md). Test report: [TEST_REPORT.md](TEST_REPORT.md). Performance graphs: [../results/report.md](../results/report.md).

## Packet-level check (Wireshark)
Capture on loopback with filter `tcp.port == 8000 || tcp.port == 9000`; frames start `46 54 02` (`"FT"`, version 2). See [WIRESHARK.md](WIRESHARK.md) for the nine screenshots to take and the useful filters (`frame contains "HACKED"` finds forged chunks).
