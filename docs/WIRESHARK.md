# Wireshark packet-level verification

## Capture

1. Start `server.py` and `proxy.py`.
2. Open Wireshark and pick the **loopback** interface
   - Windows: *Adapter for loopback traffic capture* (install Npcap with loopback support)
   - macOS: `lo0` / Linux: `lo`
3. Display filter:
   ```
   tcp.port == 8000 || tcp.port == 9000
   ```
4. Send a file (`python client.py sample_files/sample.txt` or use the dashboard).
5. Save as `captures/<scenario>.pcapng` for the report.

## Screenshots to take

| # | What | How to find it |
|---|---|---|
| 1 | TCP 3-way handshake | first 3 packets: `SYN`, `SYN, ACK`, `ACK` on port 8000 and again on 9000 |
| 2 | Our protocol header | click a data packet: bytes pane starts with `46 54 02 02` = "FT", version 2, type DATA. FLAGS byte (offset 4) is `04` for checksum16 (the default) or `00` for CRC32 |
| 3 | Sequence number field | bytes 5-8 of our header increment by 1 per chunk |
| 4 | ACK / NACK frames | small packets server to client, type byte `03` (ACK) or `04` (NACK followed by `checksum_fail` or `crc_fail`) |
| 5 | Retransmission | the same SEQ appears twice on port 9000 after a NACK |
| 6 | Checksum mode (default) | FLAGS has bit 2 set (`04`) and the CHECK field (offsets 13-16) holds a 16-bit value zero-padded to 4 bytes. With `--check crc32`, FLAGS bit 2 is clear and CHECK is a full 32-bit CRC |
| 7 | Hamming mode | with `--fec`, FLAGS = `06` (FEC + checksum), LEN (offsets 9-12) is exactly twice the data size, every payload byte <= `0x7f` |
| 8 | Conversation stats | *Statistics > Conversations > TCP* for bytes / duration / throughput |
| 9 | I/O graph | *Statistics > I/O Graphs*: throughput over time, dips at retransmissions |

## Handy filters

```
tcp.port == 9000 && tcp.len > 0          data-carrying segments to the server
frame contains "crc_fail"                NACKs from CRC mode
frame contains "checksum_fail"           NACKs from checksum mode
tcp.port == 9000 && frame[4] == 04       frames using the checksum-16 flag
frame contains "match"                   the server's RESULT frame (JSON with both SHA-256 values)
tcp.analysis.retransmission              TCP-level retransmits (should be none: ours are app-level)
```

## Talking point

Wireshark will show **zero TCP retransmissions** even while the dashboard shows dozens of ours. That's the whole point: TCP delivered the bytes perfectly -- the corruption happened *above* TCP (in our proxy), which is exactly what application-level verification is for.
