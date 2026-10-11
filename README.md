# SecureTransfer Lab

**TCP-Based Client-Server File Transfer with Error Verification** — CNL Mini Project, Topic 16, Group 4

A TCP file-transfer system that verifies every chunk with **CRC32**, can repair bit errors with **Hamming(7,4)**, and proves why checksums alone are *not* security: a man-in-the-middle proxy forges chunks and recomputes the CRC, which passes undetected until **HMAC-SHA256** is switched on. Everything is visualised live in a 3D web dashboard.

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

**Objectives**

- Design an application-level protocol with chunking, sequence numbers and ACK/NACK.
- Detect corrupted chunks with CRC32 and recover with retransmission (stop-and-wait ARQ).
- Correct single-bit errors without retransmission using Hamming(7,4) forward error correction.
- Demonstrate that a MITM can forge data with a valid CRC, and stop it with HMAC-SHA256.
- Verify the whole file end-to-end with SHA-256.
- Measure throughput, RTT, jitter, retransmissions and overhead under normal and failure conditions.

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

- **Client** splits the file into chunks, builds frames, waits for ACK per chunk, retransmits on NACK/timeout.
- **Proxy** is the "channel". It parses frames and, depending on mode, forwards them untouched, flips bits (noise), drops them (loss), delays them (latency) or forges them (attack).
- **Server** decodes FEC → checks CRC32 → checks HMAC → ACK or NACK, writes the file, and finally compares SHA-256.
- **Dashboard** only *observes* (UDP telemetry) and *controls* (proxy mode, start a transfer). The transfer never depends on it — the CLI works on its own.

## 3. Protocol / message format

17-byte fixed header, big-endian:

```
 0      2     3      4      5          9          13         17
 +------+-----+------+------+----------+----------+----------+------------------+-----------------+
 |MAGIC | VER | TYPE |FLAGS |   SEQ    |   LEN    |  CRC32   | HMAC (32 B, opt) | PAYLOAD (LEN B) |
 | "FT" |  1  |      |      |  uint32  |  uint32  |  uint32  | if FLAGS bit0    |                 |
 +------+-----+------+------+----------+----------+----------+------------------+-----------------+
```

| Field | Meaning |
|---|---|
| TYPE | 1 META · 2 DATA · 3 ACK · 4 NACK · 5 DONE · 6 RESULT · 7 ERR |
| FLAGS | bit0 = HMAC present · bit1 = payload Hamming-encoded |
| SEQ | chunk number (0-based) |
| LEN | payload bytes **on the wire** (2× data size when Hamming is on) |
| CRC32 | CRC32 of the **plaintext** chunk (before FEC) |
| HMAC | HMAC-SHA256(key, header ‖ plaintext) — key is pre-shared between client and server only |

**Exchange (stop-and-wait ARQ)**

```
Client                                   Server
  │── META {name,size,chunks,sha256} ──▶ │  open file
  │◀──────────────── ACK 0 ──────────────│
  │── DATA seq=0 ──────────────────────▶ │  FEC decode → CRC → HMAC
  │◀──────────────── ACK 0 ──────────────│
  │── DATA seq=1 ──────────────────────▶ │  CRC mismatch
  │◀────────── NACK 1 "crc_fail" ────────│
  │── DATA seq=1 (retransmit) ─────────▶ │
  │◀──────────────── ACK 1 ──────────────│
  │            …                         │
  │── DONE ────────────────────────────▶ │  SHA-256(file) == META.sha256 ?
  │◀──── RESULT {match, expected, got} ──│
```

**Hamming(7,4):** each byte → two 4-bit nibbles → two 7-bit codewords `p1 p2 d1 p3 d2 d3 d4`. The syndrome `s1 s2 s3` gives the position of a single flipped bit, which is corrected. Two flips in one codeword are mis-corrected — CRC32 then catches it and the chunk is retransmitted.

## 4. Setup

Python 3.9+.

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate      macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

The dashboard's JavaScript libraries (Three.js, Chart.js, Socket.IO) are bundled in `dashboard/static/vendor/`, so **no internet is needed** during the demo.

## 5. Running

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
python proxy.py --mode attack --rate 0.2         # MITM
python client.py sample_files/sample.txt         # → FILE CORRUPTED, CRC was fooled
python client.py sample_files/sample.txt --hmac  # → forged chunks rejected, file verified
```

Client options: `--hmac --fec --chunk 1024 --delay 40 --port 8000|9000 --host <ip>`.
Proxy options: `--mode clean|noise|attack --rate 0.1 --bits 1 --delay <ms> --loss 0.05`.

**Multiple laptops on the same Wi-Fi** (A = server, B = client + proxy + dashboard):

```bash
# laptop A
ST_TELEMETRY_HOST=<B's IP> python server.py
# laptop B
ST_SERVER_HOST=<A's IP> python proxy.py
python dashboard/app.py
```

On Windows PowerShell use `$env:ST_SERVER_HOST="192.168.x.x"; python proxy.py`. Allow Python through the firewall on both laptops.

## 6. Five-minute demo script

Press the number keys or click the presets in the dashboard.

| Key | Preset | What the examiner sees | Point to make |
|---|---|---|---|
| 1 | Clean link | All green, SHA-256 match | Baseline protocol works |
| 2 | Noisy link | Red cells flip to yellow | CRC32 detects, NACK → retransmit |
| 3 | Noise + Hamming | Blue cells, **0 retransmits** | FEC repairs 1-bit errors in place |
| 4 | MITM attack | Orange cells, every chunk ACKed, **FILE TAMPERED** | A checksum is not authentication |
| 5 | Attack + HMAC | Purple cells, **ATTACK BLOCKED** | Only a keyed MAC stops forgery |

After step 4, open `received/sample.txt` and search for `HACKED!!` — the injected bytes are right there.

## 7. Tests

```bash
python -m unittest discover -s tests -v
```

24 tests: Hamming correctness for every bit position, CRC detection, HMAC rejection, frame round-trips, plus end-to-end runs through a real proxy for clean / noise / FEC / burst errors / attack / HMAC / frame loss + timeout / latency / server down / retry-limit. See [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md).

## 8. Performance results

```bash
python bench.py     # ≈30 s, writes results/*.csv, results/*.png, results/report.md
```

Key findings (128 KB file, 2 ms emulated link, 3-run average):

- **CRC + ARQ** throughput falls ~50 % as the corrupted-chunk rate rises to 50 % (every error costs a round trip).
- **Hamming FEC** stays flat with **zero retransmissions** for 1-bit errors — but doubles bytes on the wire (100 % overhead). On a bandwidth-limited link that overhead would cost throughput; on a latency-bound link FEC wins.
- Throughput is RTT-bound: stop-and-wait gives ≈ chunk_size / RTT, so bigger chunks scale almost linearly.
- **Attack:** CRC-only → 0 % of files correct. With HMAC → 100 % correct, every forgery rejected.

Full tables and graphs: [`results/report.md`](results/report.md).

> Dashboard throughput is deliberately slowed by "Demo speed" so the animation is visible. Use `bench.py` for real numbers.

## 9. Wireshark verification

See [`docs/WIRESHARK.md`](docs/WIRESHARK.md). In short: capture on the loopback adapter, filter `tcp.port == 8000 || tcp.port == 9000`, and you'll see the 3-way handshake, frames starting with `46 54` (`"FT"`), and forged frames where the payload differs between the :8000 and :9000 legs.

## 10. Project structure

```
securetransfer/
├── protocol.py          frame format, CRC32, Hamming(7,4), HMAC
├── client.py            sender, stop-and-wait ARQ
├── server.py            receiver, verification, SHA-256 check
├── proxy.py             channel: noise / loss / latency / MITM attack
├── telemetry.py         UDP events → dashboard
├── config.py            ports, key, paths (override with env vars)
├── run_all.py           start everything with one command
├── bench.py             performance experiments → results/
├── dashboard/
│   ├── app.py           Flask + Socket.IO backend
│   ├── templates/index.html
│   └── static/  css/ · js/scene.js (Three.js) · js/app.js · vendor/
├── tests/               unit + integration tests
├── sample_files/        demo inputs
├── received/            server output
├── results/             benchmark CSV, graphs, report
└── docs/                test report, Wireshark guide, viva notes
```

## 11. Limitations (be honest in the viva)

- Stop-and-wait ARQ is simple but slow on high-latency links; sliding-window (Go-Back-N / Selective Repeat) would fix that.
- The HMAC key is pre-shared and hard-coded via `ST_KEY`. A real system would use TLS or a key-exchange.
- Hamming(7,4) only fixes one bit per 7-bit codeword; real links use stronger codes (Reed-Solomon, LDPC).
- HMAC gives integrity + authenticity, **not confidentiality** — the data is still readable in Wireshark.
