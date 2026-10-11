# Wireshark packet-level verification

## Capture

1. Start `server.py` and `proxy.py`.
2. Open Wireshark and pick the **loopback** interface
   - Windows: *Adapter for loopback traffic capture* (install Npcap with loopback support)
   - macOS: `lo0` · Linux: `lo`
3. Display filter:
   ```
   tcp.port == 8000 || tcp.port == 9000
   ```
4. Send a file (dashboard or `python client.py sample_files/sample.txt`).
5. Save as `captures/<scenario>.pcapng` for the report.

## Screenshots to take

| # | What | How to find it |
|---|---|---|
| 1 | TCP 3-way handshake | first 3 packets: `SYN`, `SYN, ACK`, `ACK` on port 8000 and again on 9000 |
| 2 | Our protocol header | click a data packet → bytes pane starts with `46 54 01 02` = "FT", version 1, type DATA |
| 3 | Sequence number field | bytes 5–8 of our header increment by 1 per chunk |
| 4 | ACK / NACK frames | small packets server→client, type byte `03` (ACK) or `04` (NACK followed by `crc_fail`) |
| 5 | Retransmission | the same SEQ appears twice on port 9000 after a NACK |
| 6 | **Forged packet** | attack mode: compare the same SEQ on :8000 vs :9000 — payload contains `HACKED!!` and the CRC bytes (13–16) differ |
| 7 | HMAC field | with `--hmac`, 32 extra bytes sit between the header and the payload |
| 8 | Conversation stats | *Statistics → Conversations → TCP* for bytes / duration / throughput |
| 9 | I/O graph | *Statistics → I/O Graphs* — throughput over time, dips at retransmissions |

## Handy filters

```
tcp.port == 9000 && tcp.len > 0          data-carrying segments to the server
frame contains "HACKED"                  forged chunks (attack mode)
frame contains "crc_fail"                NACKs caused by noise
frame contains "hmac_fail"               NACKs caused by forgery
tcp.analysis.retransmission              TCP-level retransmits (should be none: ours are app-level)
```

## Talking point

Wireshark will show **zero TCP retransmissions** even while the dashboard shows dozens of ours. That's the whole point: TCP delivered the bytes perfectly — the corruption happened *above* TCP (in our proxy), which is exactly what application-level verification is for.
