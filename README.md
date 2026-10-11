# SecureTransfer

**TCP-Based Client-Server File Transfer with Error Verification & Adaptive Defense** — CNL Mini Project, Topic 16, Group 4

A TCP file-transfer system that verifies every chunk with **CRC32** (or **16-bit Internet checksum**), can repair bit errors with **Hamming(7,4)**, and proves why checksums alone are *not* security: a man-in-the-middle proxy forges chunks and recomputes the CRC, which passes undetected until **HMAC-SHA256** is switched on. **Auto Defense** mode monitors errors in real time and upgrades protection automatically (Hamming → HMAC → quarantine → resend). Everything is visualised live in a 3D web dashboard with a built-in **Numerical Lab** for step-by-step binary arithmetic.

| Member | Role |
|---|---|
| Pooja Lingwat | _fill in — see CONTRIBUTIONS.md_ |
| Saloni Muley | |
| Aaditya Anekar | |
| Pratham Shelke | |

---

## 1. Problem statement & objectives

TCP already guarantees in-order, error-free delivery using its own 16-bit checksum. So why verify again at the application layer?

1. TCP's checksum is weak and only protects one hop of the transport — data can still be corrupted in buffers, disks or middleboxes.
2. **No checksum protects against an attacker**, because anyone who changes the data can recompute it.
3. A human choosing the right protection for every scenario is error-prone — a **closed-loop control system** that monitors, decides, acts, and verifies does it better.

**Objectives**

- Design an application-level protocol with chunking, sequence numbers and ACK/NACK.
- Detect corrupted chunks with CRC32 (and compare with the weaker 16-bit Internet checksum).
- Correct single-bit errors without retransmission using Hamming(7,4) forward error correction.
- Demonstrate that a MITM can forge data with a valid CRC, and stop it with HMAC-SHA256.
- Verify the whole file end-to-end with SHA-256; quarantine failed files instead of silently accepting them.
- Build a closed-loop **Auto Defense** system: monitor → decide → act → verify.
- Measure throughput, detection power, and loss tolerance under normal and failure conditions.
- Provide a **Numerical Lab** so students can solve checksum, CRC, and Hamming problems step by step.

## 2. Architecture

```
                 TCP :8000                      TCP :9000
 ┌──────────┐   frames    ┌─────────────────┐   frames    ┌──────────┐
 │  CLIENT  │ ──────────▶ │  PROXY (channel)│ ──────────▶ │  SERVER  │
 │client.py │ ◀────────── │    proxy.py     │ ◀────────── │server.py │
 └────┬─────┘  ACK/NACK   │ clean│noise│MITM│  ACK/NACK   └────┬─────┘
      │                   └───────┬─────────┘                  │
      │      UDP :5555 telemetry  │  ▲ UDP :5556 mode control  │
      └───────────────┐           │  │          ┌──────────────┘
                      ▼           ▼  │          ▼
                 ┌─────────────────────────────────┐   Socket.IO   ┌───────────┐
                 │   DASHBOARD  dashboard/app.py   │ ────────────▶ │  Browser  │
                 │   Flask + Flask-SocketIO :5050  │ ◀──────────── │ 3D + grid │
                 └─────────────────────────────────┘  HTTP control └───────────┘
```

- **Client** splits the file into chunks, builds frames, waits for ACK per chunk, retransmits on NACK/timeout. In **Auto Defense** mode, a closed-loop rules engine (`adaptive.py`) monitors error metrics and upgrades protection mid-transfer.
- **Proxy** is the "channel". Modes: clean, noise (bit flips), attack (MITM forgery), and word-swap (fools checksum16 but not CRC32). Supports bit-flip, delay, and frame-loss injection.
- **Server** decodes FEC → checks CRC32/checksum16 → checks HMAC → ACK or NACK. Files land in a staging area; only SHA-256-verified files are promoted to `received/`. Failed files go to `quarantine/` with a JSON sidecar.
- **Dashboard** only *observes* (UDP telemetry) and *controls* (proxy mode, start a transfer). The transfer never depends on it — the CLI works on its own.

### Closed-loop Auto Defense

```
   ┌─────────┐    error    ┌─────────┐    upgrade    ┌─────────┐    re-check    ┌─────────┐
   │ MONITOR │───metrics──▶│ DECIDE  │───protection─▶│  ACT    │───SHA-256────▶│ VERIFY  │
   │ per-chunk│            │ rules   │               │ resend  │               │ quarantine│
   └─────────┘            └─────────┘               └─────────┘               └──────────┘
         ▲                                                                          │
         └──────────────────── feedback (verified? retry?) ─────────────────────────┘
```

Rules in `adaptive.py`:
- **≥ 10% check failures** → enable Hamming FEC
- **Burst errors** → halve chunk size
- **< 2% failures over 30 chunks** → disable FEC (save bandwidth)
- **Any HMAC failure** → intrusion alert
- **SHA-256 mismatch** → quarantine + retry with HMAC
- **8 consecutive failures** → give up

## 3. Protocol / message format (v2)

17-byte fixed header, big-endian:

```
 0      2     3      4      5          9          13         17
 +------+-----+------+------+----------+----------+----------+------------------+-----------------+
 |MAGIC | VER | TYPE |FLAGS |   SEQ    |   LEN    | CHECK    | HMAC (32 B, opt) | PAYLOAD (LEN B) |
 | "FT" |  2  |      |      |  uint32  |  uint32  |  uint32  | if FLAGS bit0    |                 |
 +------+-----+------+------+----------+----------+----------+------------------+-----------------+
```

| Field | Meaning |
|---|---|
| VER | Protocol version: 2 (accepts v1 frames for backward compatibility) |
| TYPE | 1 META · 2 DATA · 3 ACK · 4 NACK · 5 DONE · 6 RESULT · 7 ERR |
| FLAGS | bit0 = HMAC present · bit1 = Hamming-encoded · bit2 = 16-bit Internet checksum (else CRC32) |
| SEQ | chunk number (0-based) |
| LEN | payload bytes **on the wire** (2× data size when Hamming is on) |
| CHECK | CRC32 **or** 16-bit Internet checksum of the plaintext chunk (selected by FLAGS bit2) |
| HMAC | HMAC-SHA256(key, header ‖ plaintext) — key is pre-shared between client and server only |

**Exchange (stop-and-wait ARQ)**

```
Client                                   Server
  │── META {name,size,chunks,sha256} ──▶ │  open file (staging area)
  │◀──────────────── ACK 0 ──────────────│
  │── DATA seq=0 ──────────────────────▶ │  FEC decode → CRC/checksum → HMAC
  │◀──────────────── ACK 0 ──────────────│
  │── DATA seq=1 ──────────────────────▶ │  CRC mismatch
  │◀────────── NACK 1 "crc_fail" ────────│
  │── DATA seq=1 (retransmit) ─────────▶ │
  │◀──────────────── ACK 1 ──────────────│
  │            …                         │
  │── DONE ────────────────────────────▶ │  SHA-256(file) == META.sha256 ?
  │◀──── RESULT {match, expected, got} ──│  ✔ → received/  ✘ → quarantine/
```

**Hamming(7,4):** each byte → two 4-bit nibbles → two 7-bit codewords `p1 p2 d1 p3 d2 d3 d4`. The syndrome `s1 s2 s3` gives the position of a single flipped bit, which is corrected. Two flips in one codeword are mis-corrected — CRC32 then catches it and the chunk is retransmitted.

**16-bit Internet checksum (RFC 1071):** ones'-complement sum of 16-bit words with end-around carry, then complement. Weaker than CRC32 — cannot detect word swaps or most 2-bit errors.

## 4. Dashboard

The dashboard has two views:

- **Simple view** (default): large 3D stage, preset buttons, verdict card. One click to run a demo.
- **Advanced view**: proxy controls, chunk inspector, timeline, session table, defense strip.

Key features:
- **Guided demo** (7 steps): walks through all five presets, then Auto Defense, then checksum-vs-CRC word swap. Click "Start guided demo" or press **G**.
- **Toast notifications**: colour-coded alerts for every event (cyan info, green success, amber warning, red danger, purple security). Max 4 visible, hover to pause auto-dismiss.
- **Health banner**: warns if server/proxy is offline; link to start them.
- **Chunk inspector**: click a chunk in the timeline to see header fields, proxy corruption details, Hamming syndrome, and a "Solve in Numerical Lab" button.
- **Defense strip**: live chips showing which protections are active (CRC32/checksum16, Hamming, HMAC) with a tooltip for each.
- **Proof modal**: hex diff of original vs quarantined file after an attack.
- **Session table**: every transfer logged with protection, retransmits, bits fixed, forged blocked, verdict. Download as Markdown or HTML report.
- **Glossary tooltips**: hover over any term with a dotted underline for a plain-English definition.

### Numerical Lab

Built into the dashboard's "Numerical Lab" tab — no internet needed, runs locally.

- **Checksum solver**: step-by-step 8/16-bit Internet checksum with ones'-complement addition, end-around carry shown at each row.
- **CRC solver**: binary long division for CRC-3, CRC-4, CRC-8, and CRC-32 with full XOR steps.
- **Hamming solver**: encode data bits → parity → codeword; flip bits → syndrome → correction. Both (7,4) and general (n,m), even/odd parity.
- **Bit strip**: click any bit to flip it and see how the receiver detects or mis-corrects.
- **Compare tab**: same data, same damage, judged by checksum / CRC-8 / Hamming alone / Hamming + CRC side by side. Scenarios: no error, 1-bit flip, 2-bit same block, 2-bit far apart, word swap.
- **Practice tab**: random exam-style questions (checksum, CRC remainder, Hamming encode, locate error, accept/reject). Answer is checked against the solver; full working shown whether right or wrong.
- **Export**: print any solution to a clean page.

## 5. Setup

Python 3.9+, Windows / macOS / Linux.

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate      macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

The dashboard's JavaScript libraries (Three.js, Chart.js, Socket.IO) are bundled in `dashboard/static/vendor/`, so **no internet is needed** during the demo.

## 6. Running

**One command (easiest):**

```bash
python run_all.py          # starts server + proxy + dashboard, opens http://localhost:5050
```

**Three terminals (best for the viva — examiners can see each component):**

```bash
python server.py                       # terminal 1
python proxy.py                        # terminal 2
python dashboard/app.py                # terminal 3 → open http://localhost:5050
```

**CLI only (no dashboard):**

```bash
python proxy.py --mode noise --rate 0.2          # noisy channel
python client.py sample_files/sample.txt         # CRC + retransmit
python client.py sample_files/sample.txt --fec   # Hamming corrects instead
python client.py sample_files/sample.txt --auto  # Auto Defense decides for you
python client.py sample_files/sample.txt --check checksum16  # weaker 16-bit checksum
python proxy.py --mode attack --rate 0.2         # MITM
python client.py sample_files/sample.txt         # → FILE CORRUPTED, CRC was fooled
python client.py sample_files/sample.txt --hmac  # → forged chunks rejected, file verified
```

Client options: `--hmac --fec --auto --check crc32|checksum16 --chunk 1024 --delay 40 --port 8000|9000 --host <ip>`.
Proxy options: `--mode clean|noise|attack --rate 0.1 --bits 1 --delay <ms> --loss 0.05 --pattern random|swap`.

**Multiple laptops on the same Wi-Fi** (A = server, B = client + proxy + dashboard):

```bash
# laptop A
ST_TELEMETRY_HOST=<B's IP> python server.py
# laptop B
ST_SERVER_HOST=<A's IP> python proxy.py
python dashboard/app.py
```

On Windows PowerShell use `$env:ST_SERVER_HOST="192.168.x.x"; python proxy.py`. Allow Python through the firewall on both laptops.

## 7. Five-minute demo script

Press the number keys or click the presets in the dashboard.

| Key | Preset | What the examiner sees | Point to make |
|---|---|---|---|
| 1 | Clean link | All green, SHA-256 match | Baseline protocol works |
| 2 | Noisy link | Red cells flip to yellow | CRC32 detects, NACK → retransmit |
| 3 | Noise + Hamming | Blue cells, **0 retransmits** | FEC repairs 1-bit errors in place |
| 4 | MITM attack | Orange cells, every chunk ACKed, **FILE TAMPERED** | A checksum is not authentication |
| 5 | Attack + HMAC | Purple cells, **ATTACK BLOCKED** | Only a keyed MAC stops forgery |

After step 4, click "Show proof" in the verdict card — a hex diff highlights exactly where `HACKED!!` was injected.

**Guided demo (recommended):** Click "Start guided demo" or press **G** — it runs all 5 presets plus Auto Defense and a checksum-vs-CRC word-swap comparison, with narration. Takes ~4 minutes.

## 8. Concept documentation

Eight faculty-ready documents with computed worked examples from live code, in the dashboard's **Docs** tab or `docs/concepts/`:

| # | Topic | Key idea |
|---|---|---|
| 1 | [TCP Client-Server](docs/concepts/01_tcp_client_server.md) | Sockets, 3-way handshake, why TCP isn't enough |
| 2 | [Chunking & ARQ](docs/concepts/02_chunking_and_arq.md) | Stop-and-wait, sequence numbers, timeouts |
| 3 | [Internet Checksum](docs/concepts/03_checksum.md) | Ones'-complement sum, end-around carry, RFC 1071, why it's weak |
| 4 | [CRC32](docs/concepts/04_crc32.md) | Polynomial division, generator, remainder, detection power |
| 5 | [Hamming Code](docs/concepts/05_hamming_code.md) | Parity positions, syndrome, single-bit correction, double-bit detection |
| 6 | [HMAC & Attacks](docs/concepts/06_hmac_and_attack.md) | Why checksums fail against MITM, keyed MACs, forgery demo |
| 7 | [SHA-256 End-to-End](docs/concepts/07_sha256_end_to_end.md) | Whole-file verification, staging, quarantine pattern |
| 8 | [Closed-Loop Auto Defense](docs/concepts/08_closed_loop_auto_defense.md) | Monitor→decide→act→verify, adaptive rules |

Each document includes worked examples generated by `docs/build_docs.py` from the actual protocol code, so the numbers always match.

## 9. Tests

```bash
python -m pytest tests/ -v
```

**117 tests** across 6 test files:

| File | Tests | Covers |
|---|---|---|
| `test_protocol.py` | 11 | Frame round-trip, Hamming correctness, CRC, HMAC |
| `test_integration.py` | 13 | End-to-end through real proxy: clean, noise, FEC, burst, attack, HMAC, loss, latency, retry |
| `test_adaptive.py` | 31 | Adaptive rules engine: FEC on/off, chunk halving, intrusion alert, give-up, retry-with-HMAC, closed-loop integration |
| `test_checksum.py` | 18 | 16-bit checksum, v1/v2 frame compat, word-swap detection |
| `test_numericals.py` | 42 | All solvers match protocol/zlib, compare view, practice mode |
| `test_docs.py` | 2 | Generated doc blocks current, report completeness |

See [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md) for the full list.

## 10. Performance results

```bash
python bench.py     # ≈90 s, writes results/*.csv, results/*.png, results/report.md
```

**7 experiments**, 6 graphs:

| Experiment | Graph | Key finding |
|---|---|---|
| 1. Error rate sweep | `noise_tradeoff.png` | CRC + ARQ throughput falls ~50% at 50% error rate; FEC stays flat |
| 2. Chunk size scaling | `chunk_size.png` | Throughput scales ~linearly with chunk size (stop-and-wait is RTT-bound) |
| 3. RTT / latency | `latency.png` | Throughput ∝ 1/RTT as expected |
| 4. Attack success | _(in report)_ | CRC-only → 0% files correct; HMAC → 100% correct |
| 5. Adaptive Defense | `adaptive.png` | Auto Defense tracks close to Fixed FEC while CRC+ARQ drops at high error rates |
| 6. Detection power | `detection.png` | CRC32 catches 100% of all patterns; checksum16 misses ~3% of 2-bit errors and 0% of word swaps |
| 7. Frame loss sweep | `loss.png` | 10% frame loss → throughput drops to ~23 KB/s but all files still verify |

Full tables and graphs: [`results/report.md`](results/report.md).

> Dashboard throughput is deliberately slowed by "Demo speed" so the animation is visible. Use `bench.py` for real numbers.

## 11. Wireshark verification

See [`docs/WIRESHARK.md`](docs/WIRESHARK.md). In short: capture on the loopback adapter, filter `tcp.port == 8000 || tcp.port == 9000`, and you'll see the 3-way handshake, frames starting with `46 54` (`"FT"`), and forged frames where the payload differs between the :8000 and :9000 legs.

## 12. Project structure

```
securetransfer/
├── protocol.py          frame format, CRC32, checksum16, Hamming(7,4), HMAC
├── client.py            sender, stop-and-wait ARQ, Auto Defense mode
├── server.py            receiver, verification, SHA-256, staging & quarantine
├── proxy.py             channel: noise / loss / latency / MITM / word-swap
├── adaptive.py          closed-loop rules engine (monitor → decide → act → verify)
├── numericals.py        Numerical Lab: step-by-step solvers, compare, practice
├── telemetry.py         UDP events → dashboard
├── config.py            ports, key, paths (override with env vars)
├── run_all.py           start everything with one command
├── bench.py             7 performance experiments → results/
├── dashboard/
│   ├── app.py           Flask + Socket.IO backend + Numerical Lab API
│   ├── mdlite.py        tiny Markdown → HTML renderer for docs
│   ├── templates/index.html   Simple/Advanced views, Numerical Lab tab
│   └── static/
│       ├── css/style.css      main layout
│       ├── css/ui.css         tabs, views, toasts, modals, inspector, lab
│       ├── js/scene.js        Three.js 3D visualisation
│       ├── js/app.js          telemetry, scenario cards, chunk inspector
│       ├── js/toast.js        colour-coded toast notifications
│       ├── js/glossary.js     hover/click tooltips for CN terms
│       ├── js/demo.js         7-step guided demo with narration
│       ├── js/lab.js          Numerical Lab UI: solvers, compare, practice
│       └── vendor/            Three.js, Chart.js, Socket.IO (bundled, no CDN)
├── tests/               6 test files, 117 tests
├── sample_files/        demo inputs
├── received/            server output (verified files)
├── quarantine/          failed files with JSON sidecars
├── results/             benchmark CSV, graphs, report
└── docs/
    ├── concepts/        8 faculty-ready concept documents
    ├── build_docs.py    fills worked examples from live code
    ├── FACULTY_DEMO_GUIDE.md
    ├── TEST_REPORT.md
    ├── WIRESHARK.md
    ├── VIVA_NOTES.md
    └── REQUIREMENTS_TRACEABILITY.md
```

## 13. Limitations (be honest in the viva)

- Stop-and-wait ARQ is simple but slow on high-latency links; sliding-window (Go-Back-N / Selective Repeat) would fix that.
- The HMAC key is pre-shared and hard-coded via `ST_KEY`. A real system would use TLS or a key-exchange.
- Hamming(7,4) only fixes one bit per 7-bit codeword; real links use stronger codes (Reed-Solomon, LDPC).
- HMAC gives integrity + authenticity, **not confidentiality** — the data is still readable in Wireshark.
- Auto Defense is reactive, not predictive — it can't prevent the first failure, only respond to it.
- The Numerical Lab limits input to 256 bits to keep step-by-step display manageable.
