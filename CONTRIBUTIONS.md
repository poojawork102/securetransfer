# Team contributions

This is a *suggested* split of the v2 work — edit it to match what each person actually did. Each member should be able to explain their part in the viva, and their commits should show up in the repo history.

| Member | Owns | Files | Also |
|---|---|---|---|
| Pooja Lingwat | Protocol design, error-detection/correction & security | `protocol.py` (frame format v2, CRC32, 16-bit checksum, Hamming, HMAC), `proxy.py` (noise / word-swap / attack), `numericals.py` | Architecture diagram, `docs/concepts/03–06` |
| Saloni Muley | Server: verification, ACK/NACK, SHA-256 check, quarantine | `server.py` | Wireshark captures, `docs/concepts/01, 07`, `docs/WIRESHARK.md` |
| Aaditya Anekar | Client: chunking, stop-and-wait ARQ, timeouts, Auto Defense closed loop | `client.py`, `adaptive.py`, `run_all.py` | Performance benchmarks (`bench.py`), `docs/concepts/02, 08` |
| Pratham Shelke | Dashboard & testing | `dashboard/` (Simple view, toasts, guided demo, Numerical Lab UI, chunk inspector), `tests/` | Test report, traceability table, README, faculty demo guide |
