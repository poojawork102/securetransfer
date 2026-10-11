# Requirements traceability

Every item the faculty asked for, mapped to where it is implemented, the test that proves it, the demo step that shows it, and the evidence to point at. Test IDs refer to [TEST_REPORT.md](TEST_REPORT.md); demo steps to the guided/full demo (steps 1–6) or the Advanced presets (P1–P6).

## 1. Core concepts named in the brief

| Concept | Implementation | Test IDs | Demo step | Evidence |
|---|---|---|---|---|
| **TCP sockets** | `server.py` (`bind/listen/accept`), `client.py` (`create_connection`), `protocol.recv_exact` | I1, I2, I3, I11, I12 | step 1 | [concept 01](concepts/01_tcp_client_server.md); `screenshots/simple_view.png`; Wireshark handshake (to capture, see [WIRESHARK.md](WIRESHARK.md)) |
| **Client–server** | `client.py` ⇄ `proxy.py` ⇄ `server.py` | I1, I2, L1 | step 1 | architecture diagram in [README](../README.md) and the [faculty guide](FACULTY_DEMO_GUIDE.md) |
| **Checksum** (literal) | 16-bit Internet checksum: `protocol.internet_checksum16`, `--check checksum16`, dashboard "Error check" selector | C1–C9, C14–C18, N2–N6 | P6 | [concept 03](concepts/03_checksum.md); `screenshots/checksum_vs_crc.png`; `results/detection.png` |
| **CRC** | `protocol.crc32` (default check) | U6, I4, U9, N8–N16 | step 2 | [concept 04](concepts/04_crc32.md); `results/noise_tradeoff.png` |
| **Hamming code** | `protocol.hamming74_*`, `--fec` | U1–U4, U7, I5, I6, C13, N17–N24 | step 3 | [concept 05](concepts/05_hamming_code.md); `screenshots/hamming_selfheal.png`; `screenshots/chunk_inspector.png` |
| Beyond the brief: HMAC, SHA-256, quarantine, closed loop | `protocol.compute_hmac`, `server._quarantine`, `adaptive.py` | U9–U11, I7, I8, Q1–Q3, R1–R20, L1–L8 | steps 4–6 | concepts [06](concepts/06_hmac_and_attack.md), [07](concepts/07_sha256_end_to_end.md), [08](concepts/08_closed_loop_auto_defense.md) |

## 2. Faculty deliverables

| # | Deliverable | Where it is | Test IDs | Demo step | Evidence |
|---|---|---|---|---|---|
| 1 | Problem statement & objectives | [README §1](../README.md) | — | — | README |
| 2 | Network architecture / topology | [README §2](../README.md) client → proxy (channel) → server over two TCP legs, UDP telemetry to the dashboard; [faculty guide](FACULTY_DEMO_GUIDE.md) diagram. The optional Mininet multi-host topology (Phase 3) is **not built**; multi-laptop use is documented in README §5 | — | — | diagrams |
| 3 | Protocol / message-format design | `protocol.py` header (17 bytes, v2) ; README §3; [concept 02](concepts/02_chunking_and_arq.md) | U5, U8, C5, C6, C10–C12 | step 2 | annotated frame dump in concepts 01 (generated from code) |
| 4 | Working implementation | `client.py`, `server.py`, `proxy.py`, `adaptive.py`, `dashboard/` | I1–I12, L1–L8 | full demo | live demo |
| 5 | Test cases — normal **and** failure conditions | `tests/` (117 automated tests) | all | — | [TEST_REPORT.md](TEST_REPORT.md): clean, noise, burst, forgery, frame loss, latency, server down, retry limit, dropped connection, giving up |
| 6 | Performance results: **delay** | `bench.py` latency sweep (added latency → RTT, throughput) | I10 | — | `results/latency.png` |
| 6 | **throughput** | error-rate sweep, chunk-size sweep, Auto vs fixed | I4, I5, L3 | step 2–3 | `results/noise_tradeoff.png`, `chunk_size.png`, `adaptive.png` |
| 6 | **loss** | frame-loss sweep (dropped frames recovered by timeout) | I9 | — | `results/loss.png` |
| 6 | **latency / RTT** | live RTT chart + `bench.py` | I10 | Advanced view | `results/latency.png` |
| 6 | **jitter** | `jitter_ms` in every transfer's stats, tile in dashboard, `bench.py` tables | — (measured, not asserted) | Advanced view | `results/report.md` §2 |
| 6 | **accuracy** (is the received file correct?) | `verified_pct` in every `bench.py` row; detection power checksum vs CRC | I7, I8, C14–C18 | steps 4–5 | `results/report.md` §4, §6; `results/detection.png` |
| 7 | Source code + README | repository, [README](../README.md) | D1, D2 (docs match code) | — | GitHub repo |
| 8 | 5-minute demo | dashboard "Run full demo" (≈ 3½ min narrated, leaves time for questions) · [faculty guide](FACULTY_DEMO_GUIDE.md) | M7 | all six | live |
| 9 | Individual viva | "Likely viva questions" at the end of each of the 8 concept notes; [VIVA_NOTES.md](VIVA_NOTES.md); [CONTRIBUTIONS.md](../CONTRIBUTIONS.md) says who owns which module | — | — | — |
| 10 | Wireshark packet-level verification | [WIRESHARK.md](WIRESHARK.md): filters, offsets, 9 screenshots to take (each concept note ends with its own "Wireshark evidence") | — | any | **Captures not produced here** — they require Wireshark/Npcap on the team's machine; the byte offsets in the notes are derived from the protocol and are asserted by tests U5/C5/C6, but no `.pcapng` is included yet |
| 11 | Architecture diagram | [README §2](../README.md), [faculty guide](FACULTY_DEMO_GUIDE.md) | — | — | diagrams |
| 12 | Test report | [TEST_REPORT.md](TEST_REPORT.md) (auto-checked against the tests by D2) | D2 | — | report |
| 13 | Live demo | `python run_all.py` → http://localhost:5050 (Simple view, guided demo, Numerical Lab) | M1–M11 | all | screenshots in `docs/screenshots/` |
| 14 | Clear attribution of each member's contribution | [CONTRIBUTIONS.md](../CONTRIBUTIONS.md) (module ownership) + git history (one commit per member-sized chunk) | — | — | `git log --author` |

## 3. Requirements added in v2 (this iteration)

| Requirement | Where | Tests | Evidence |
|---|---|---|---|
| Closed loop: monitor → decide → act → verify | `adaptive.py`, `client._run_attempt`, `server` quarantine | R1–R20, L1–L8, Q1–Q3 | concept 08; `screenshots/auto_defense.png` |
| Never silently accept bad data | file moves to `received/` only after SHA-256 matches; else `quarantine/` + JSON sidecar | Q1–Q3, L6, L8 | concept 07; `screenshots/quarantine_proof.png` |
| Toast notifications | `dashboard/static/js/toast.js` + events in `app.js` | M7, M8 | `screenshots/auto_defense.png` |
| Usable by a first-time visitor | welcome screen, Simple view, guided demo, plain-language tooltips, health banner | M7, M8, M11 | `screenshots/simple_view.png`, `guided_demo.png`, `offline_banner.png`, `mobile.png` |
| Faculty concept notes (8) | [concepts/](concepts/) | D1 | the notes |
| Literal checksum mode | `FLAGS` bit 2, `--check`, `proxy --pattern swap` | C1–C18 | concept 03 |
| Numerical Lab | `numericals.py`, `/api/numerical`, `dashboard/static/js/lab.js` | N1–N29 | `screenshots/lab_*.png` |
| Chunk inspector with the exact flipped bit and Hamming syndrome | proxy `corrupt` telemetry (`wire_byte`, `bit`, `syndrome`), server `fixes` | C13, M10 | `screenshots/chunk_inspector.png` |
| Proxy state is read, not reset, on page load | `app.js` `syncFromProxy` (from the heartbeat) | M7 | — |
