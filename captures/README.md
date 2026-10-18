# Wireshark captures

Save real .pcapng files here. See docs/WIRESHARK.md for instructions.

Required captures:
1. handshake.pcapng - TCP 3-way handshake
2. header.pcapng - Frame header bytes 46 54 02 02
3. sequence.pcapng - Sequence numbers incrementing
4. ack_nack.pcapng - ACK and NACK frames
5. retransmit.pcapng - Retransmission after NACK
6. loss.pcapng - Frame loss and timeout recovery
