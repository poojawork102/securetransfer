# Team contributions

Edit this to match what each person actually did. Each member should be able to explain their part in the viva.

| Member | Owns | Files | Also |
|---|---|---|---|
| Pooja Lingwat | Protocol design, error detection/correction | `protocol.py` (frame format v2, CRC32, 16-bit checksum, Hamming), `proxy.py` (noise / word-swap), `numericals.py` | Architecture diagram, `docs/PROTOCOL.md` |
| Saloni Muley | Server: verification, ACK/NACK, SHA-256 check | `server.py` | Wireshark captures, `docs/WIRESHARK.md` |
| Aaditya Anekar | Client: chunking, stop-and-wait ARQ, timeouts | `client.py`, `run_all.py` | Performance benchmarks (`bench.py`) |
| Pratham Shelke | Dashboard, frontend, testing | `frontend/` (React UI, 4 tabs), `dashboard/app.py` (Flask API), `tests/` | Test report, README, demo script |
