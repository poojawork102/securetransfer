# SecureTransfer

TCP-Based Client-Server File Transfer with Error Verification.
CNL Mini Project, Topic 16, Group 4.

| Member | PRN | Panel |
|---|---|---|
| Pooja Lingwat | 1262242831 | C |
| Saloni Muley | 1262242828 | C |
| Aaditya Anekar | 1262242880 | C |
| Pratham Shelke | | |

## Overview

A file transfer system over TCP that verifies every chunk using a 16-bit Internet
checksum (RFC 1071). When a chunk is corrupted, the server sends a NACK and the client
retransmits it. Hamming(7,4) forward error correction can repair single-bit errors
without retransmission. CRC32 is available as a stronger detector for comparison.
A SHA-256 hash of the whole file is checked at the end.

A proxy sits between client and server to inject bit errors (noise) or word swaps,
and a React + Flask dashboard visualises the transfer live.

## Architecture

```
Client :8000 --> Proxy (channel) :9000 --> Server
                     |
         UDP :5555 telemetry
                     v
              Dashboard :5050
```

See the "How it works" tab in the dashboard for the full SVG diagrams.

## Setup

Python 3.9+. Node.js 18+ (for the frontend build).

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cd frontend
npm install
npm run build
cd ..
```

## Running

One command:

```
python run_all.py
```

Three terminals (for the viva):

```
python server.py           (terminal 1)
python proxy.py            (terminal 2)
python dashboard/app.py    (terminal 3, open http://localhost:5050)
```

CLI only:

```
python proxy.py --mode noise --rate 0.2
python client.py sample_files/sample.txt
python client.py sample_files/sample.txt --fec
python client.py sample_files/sample.txt --check crc32
```

Client flags: `--fec`, `--check checksum16|crc32`, `--chunk 1024`.
Proxy flags: `--mode clean|noise`, `--rate 0.2`, `--bits 1`, `--loss 0.05`.

## Demo (5 minutes)

Press keys 1 to 4 in the dashboard, or click the objectives:

| # | Objective | Expected result |
|---|---|---|
| 1 | Does the file arrive intact? | SHA-256 verified |
| 2 | Does the checksum detect damage? | Damaged chunks NACKed, retransmitted |
| 3 | Can Hamming fix errors without retransmission? | 0 retransmits, errors corrected |
| 4 | Checksum vs CRC32: which detects more? | Checksum misses word swap, CRC catches it |

See `docs/DEMO_SCRIPT.md` for the full script.

## Tests

```
python -m pytest tests/ -v
```

67 tests across 4 files: protocol, integration, checksum, numericals.
See `docs/TEST_REPORT.md`.

## Performance

```
python bench.py
```

5 experiments: error rate sweep, chunk size, latency, detection power (checksum vs CRC32),
frame loss. Results in `results/`.

Key findings:
- Checksum + ARQ throughput drops 50% at 50% error rate.
- Hamming FEC maintains throughput with 0 retransmissions for 1-bit errors.
- CRC32 detects 100% of all tested error patterns. Checksum misses some 2-bit errors.
- 10% frame loss reduces throughput but all files still verify.

## Wireshark

See `docs/WIRESHARK.md`. Filter: `tcp.port == 8000 || tcp.port == 9000`.
Real captures go in `captures/`.

## Limitations

- Stop-and-wait is slow on high-latency links. Go-Back-N would improve throughput.
- Hamming(7,4) corrects only 1 bit per codeword. Real links use stronger codes.
- Data is not encrypted: it is readable in Wireshark. A real system would use TLS.
- Mininet topology is not implemented.

## References

1. RFC 793, Transmission Control Protocol.
2. RFC 1071, Computing the Internet Checksum.
3. R. W. Hamming, "Error Detecting and Error Correcting Codes," 1950.
4. FIPS 180-4, Secure Hash Standard (SHA-256).
