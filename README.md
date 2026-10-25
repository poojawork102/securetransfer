# SecureTransfer

**TCP file transfer with chunk-level error detection, correction and verification.**

Computer Networks Lab (CNL) mini project -- Topic 16, Group 4
MIT-WPU, School of Computer Science, B.Tech CSE, TY, Academic Year 2026-27

---

## Team

| Member | PRN | Contribution |
|---|---|---|
| Pooja Lingwat | 1262242831 | Protocol design (`protocol.py`), error detection/correction (CRC-32, 16-bit checksum, Hamming), proxy/channel simulation (`proxy.py`), numerical solvers (`numericals.py`), architecture diagram, `docs/PROTOCOL.md` |
| Saloni Muley | 1262242828 | Server-side verification (`server.py`), ACK/NACK logic, SHA-256 whole-file check |
| Aaditya Anekar | 1262242880 | Client-side chunking and stop-and-wait ARQ (`client.py`), launcher (`run_all.py`), performance benchmarks (`bench.py`) |
| Pratham Shelke | -- | Dashboard and frontend (`dashboard/`, `frontend/`), Flask API, React UI with 4 tabs, test suite (`tests/`), test report, demo script |

---

## Problem statement

Design and implement a file transfer system over TCP that demonstrates how error detection, error correction and retransmission mechanisms work at the data-link and transport layers. The system should let users observe, in real time, what happens when data is corrupted during transit and how different protection schemes respond.

## Objectives

1. **Does the file arrive intact?** -- Transfer a file over a clean channel using TCP, chunking and SHA-256 verification.
2. **Does the checksum detect damaged chunks?** -- Inject bit-flip errors at 30% rate and verify that the 16-bit Internet checksum detects every corrupted chunk, triggering NACK and retransmission.
3. **Can Hamming fix 1-bit errors without retransmission?** -- Enable Hamming(7,4) FEC and confirm that single-bit errors are corrected in place with zero retransmissions.
4. **Checksum vs CRC-32: which detects more?** -- Inject word-swap corruption to show that the 16-bit checksum misses swaps (its known blind spot) while CRC-32 catches them.

## Computer Networks concepts demonstrated

- TCP socket programming (connection-oriented, reliable byte stream)
- Chunking and reassembly (segmentation at the application layer)
- Error detection: 16-bit Internet checksum (RFC 1071), CRC-32
- Error correction: Hamming(7,4) forward error correction
- Stop-and-wait ARQ (ACK, NACK, timeout, retransmission)
- Channel simulation (bit flips, word swaps, configurable error rate)
- Whole-file verification with SHA-256
- UDP telemetry and real-time event streaming (Socket.IO)

---

## Tools and environment

| Item | Version / Detail |
|---|---|
| Operating system | Windows 11 |
| Language (backend) | Python 3.9+ |
| Language (frontend) | JavaScript (React 19, Vite 6) |
| Runtime | Node.js 18+ |
| Web framework | Flask 3.0, Flask-SocketIO 5.3 |
| Browser | Any modern browser (Chrome, Firefox, Edge) |
| Dependency file | `requirements.txt` (Python), `frontend/package.json` (Node) |

### Dependencies

Python packages (listed in `requirements.txt`):

```
flask>=3.0
flask-socketio>=5.3
simple-websocket>=1.0
matplotlib>=3.7       # only needed for bench.py graphs
```

Node packages are installed via `npm install` inside the `frontend/` directory.

---

## Installation and execution

### Step 1 -- Clone and install

```bash
git clone https://github.com/poojawork102/securetransfer.git
cd securetransfer

# Python dependencies
pip install -r requirements.txt

# Frontend dependencies and build
cd frontend
npm install
npm run build
cd ..
```

### Step 2 -- Run (recommended)

```bash
python run_all.py
```

This starts the server, proxy and dashboard in the correct order. The browser opens automatically at `http://localhost:5050`.

### Step 3 -- Or start manually (3 terminals, in this order)

```bash
# Terminal 1 -- Server (listens on port 9000)
python server.py

# Terminal 2 -- Proxy/Channel (listens on port 8000, forwards to server on 9000)
python proxy.py

# Terminal 3 -- Dashboard (serves UI on port 5050)
python dashboard/app.py
```

Then open `http://localhost:5050` in a browser.

### Ports

| Component | Port | Protocol |
|---|---|---|
| Server | 9000 | TCP |
| Proxy/Channel | 8000 | TCP (accepts client connections) |
| Proxy control | 5556 | UDP (mode changes from dashboard) |
| Telemetry | 5555 | UDP (events from all components) |
| Dashboard | 5050 | HTTP + WebSocket |

### CLI-only usage (no browser)

```bash
# Start server and proxy first, then:
python client.py sample_files/sample.txt --check crc32 --fec --chunk 1024
```

---

## Example inputs and expected results

### Sample files

| File | Size | Location |
|---|---|---|
| `sample.txt` | ~64 KB | `sample_files/` |
| `random_256k.bin` | 256 KB | `sample_files/` |

### Expected results per objective

| # | Objective | Configuration | Expected result |
|---|---|---|---|
| 1 | File arrives intact | Clean channel, checksum | SHA-256 match, 0 errors, 0 retransmissions |
| 2 | Checksum detects damage | 30% noise, bit flips | All corrupted chunks NACKed and retransmitted, SHA-256 match |
| 3 | Hamming corrects errors | 30% noise, Hamming FEC | 1-bit errors corrected in place, 0 retransmissions, SHA-256 match |
| 4 | Checksum vs CRC-32 | Word-swap corruption | Checksum misses swaps (SHA-256 mismatch), CRC-32 catches them (SHA-256 match) |

Each objective shows real-time chunk map, metric tiles, Expected vs Observed table with PASS/FAIL badges, SHA-256 hash comparison and a protocol log.

### Testing evidence

67 automated tests across 4 modules:

```bash
python -m pytest tests/ -v
```

| Module | Covers |
|---|---|
| `test_protocol.py` | Frame build/parse, CRC-32, checksum, Hamming encode/decode |
| `test_integration.py` | Full client-server transfers (clean, noise, FEC, word swap) |
| `test_checksum.py` | Internet checksum edge cases |
| `test_numericals.py` | Calculator solver correctness |

Screenshots of demo results are in `docs/screenshots/`.

See `docs/TEST_REPORT.md` for the full test report.

---

## Architecture

```
Client (:8000) --TCP--> Proxy/Channel --TCP--> Server (:9000)
                              |
                       UDP telemetry (:5555)
                              |
                       Dashboard (:5050) --Socket.IO--> Browser
```

The proxy sits between client and server. In clean mode it forwards everything unchanged. In noise mode it flips random bits or swaps 16-bit words in DATA payloads. All components emit UDP telemetry to the dashboard, which pushes events to the browser via Socket.IO for real-time visualization.

### Protocol

17-byte big-endian header followed by a variable-length payload:

```
 0      2     3     4     5        9        13       17
 MAGIC  VER  TYPE  FLAGS  SEQ(4B)  LEN(4B)  CHECK(4B)  PAYLOAD
 "FT"    2    1B    1B
```

Frame types: META, DATA, ACK, NACK, DONE, RESULT, ERR

See `docs/PROTOCOL.md` for the full specification.

### Calculator

The Calculator tab provides interactive solvers with step-by-step working for Checksum, CRC and Hamming. Clicking an error chunk in the demo opens the Calculator pre-filled with representative data.

---

## Known limitations

- **Stop-and-wait ARQ** sends one chunk at a time. Go-Back-N or Selective Repeat would improve throughput.
- **Hamming(7,4)** corrects only 1 bit per 7-bit codeword (75% overhead). Reed-Solomon or LDPC handle burst errors better.
- **No encryption.** Data is readable on the wire. A production system would add TLS.
- **Single client.** The server handles one transfer at a time.

---

## File structure

```
securetransfer/
  client.py              Chunking, stop-and-wait ARQ
  server.py              Verification, ACK/NACK, SHA-256
  proxy.py               Channel simulation (bit flips, word swaps)
  protocol.py            Frame format, CRC-32, checksum, Hamming(7,4)
  numericals.py          Calculator solver engine
  config.py              Ports, timeouts, paths
  telemetry.py           UDP event emitter
  run_all.py             Starts server + proxy + dashboard
  bench.py               Performance benchmarks
  requirements.txt       Python dependencies
  CONTRIBUTIONS.md       Team member contributions
  dashboard/
    app.py               Flask + Socket.IO backend
  frontend/
    src/                 React 19 + Vite 6 source
    dist/                Built frontend (committed)
    package.json         Node dependencies
  tests/                 pytest suite (67 tests)
  sample_files/          Default transfer files
  results/               Benchmark CSVs and graphs
  docs/
    PROTOCOL.md          Binary frame protocol specification
    TEST_REPORT.md       Test results and coverage
    DEMO_SCRIPT.md       Step-by-step demo walkthrough
    VIVA_NOTES.md        Viva preparation notes
    screenshots/         UI screenshots and test evidence
    diagrams/            Architecture diagrams
```

---

## Documentation

| Document | Location | Status |
|---|---|---|
| Protocol specification | `docs/PROTOCOL.md` | Complete |
| Test report | `docs/TEST_REPORT.md` | Complete |
| Demo script | `docs/DEMO_SCRIPT.md` | Complete |
| Viva notes | `docs/VIVA_NOTES.md` | Complete |
| Final report (PDF, 2-40 pages) | `docs/` | To be added |
| Presentation (PPTX, 12-20 slides) | `docs/` | To be added |

---

## Video and Drive link

Implementation and presentation video: _To be added_

---

## References

1. RFC 793 -- Transmission Control Protocol
2. RFC 1071 -- Computing the Internet Checksum
3. R. W. Hamming, "Error Detecting and Error Correcting Codes," Bell System Technical Journal, 1950
4. FIPS 180-4 -- Secure Hash Standard (SHA-256)
5. W. Stallings, _Data and Computer Communications_, 10th edition, Pearson, 2013
6. A. S. Tanenbaum and D. J. Wetherall, _Computer Networks_, 5th edition, Pearson, 2011

## Attribution

- Flask and Flask-SocketIO by Pallets Projects and Miguel Grinberg (BSD licence)
- React by Meta (MIT licence)
- Vite by Evan You (MIT licence)
- Chart.js by Chart.js contributors (MIT licence)
- IBM Plex fonts by IBM (SIL Open Font Licence)

No passwords, access tokens, private keys or personal datasets are included in this repository.

## Suggested improvements for future batches

- Implement Go-Back-N or Selective Repeat ARQ for higher throughput.
- Add TLS encryption for secure data transfer.
- Support concurrent multi-client transfers.
- Add Reed-Solomon or LDPC codes for burst error correction.
- Integrate Wireshark packet captures into the dashboard for deeper protocol analysis.
