# 06 · Why any unkeyed check can be forged — and how HMAC stops it

## In one line
A checksum or CRC has no secret, so an attacker who changes the data can simply recompute it; **HMAC-SHA256** mixes a secret key into the fingerprint, so only someone who knows the key can produce a valid one.

## The problem it solves (real-life example)
A cheque with an amount and a "check digit" printed next to it: a forger who changes the amount just recalculates the check digit. A cheque with a **signature** can't be redone without the signer's pen. HMAC is the signature; CRC is the check digit.

## How it works

**The attack (man-in-the-middle).** Our proxy sits between client and server. In *attack* mode, for a fraction of chunks it (1) overwrites some bytes with `HACKED!!`, then (2) **recomputes a valid CRC32 for the changed data**. The server's CRC check passes, the chunk is ACKed, and the file is silently wrong.

<!-- GEN:forge_demo -->
```text
original : b'transfer 100 rupees to Pooja. transfer 100 rupees to Pooja. transfer 100 rupees to Pooja. '
forged   : b'transfer 100 rupees to Pooja. transfer 100 rupeesHACKED!!a. transfer 100 rupees to Pooja. '
CRC32 recomputed by the attacker: 0x1b5bc657  (valid: the receiver's CRC check PASSES)
HMAC attached to the frame is the OLD one -> receiver verdict with HMAC on: hmac_fail
```
<!-- /GEN -->

**The defence.** With HMAC on, each frame carries `HMAC-SHA256(key, header ‖ plaintext)` (32 bytes, FLAGS bit 0). The key is shared by client and server only. The attacker can edit the data and recompute the CRC — but cannot compute a matching HMAC without the key, so the server answers **NACK `hmac_fail`** and the client re-sends the chunk untouched. Because the header (SEQ, FLAGS, LEN) is inside the MAC, reordering or relabelling chunks is caught too.

<!-- GEN:hmac_example -->
```text
key     = b'cnl-group4-secret-key'
message = header(17 bytes) || 'HELLO'
HMAC-SHA256 with the right key : 250c366b2230df08fda9d5a1370fb02a3a065a28701f4e8d4516e5c139201efd
HMAC-SHA256 with a wrong key   : c31a9964a11cc2a2e1188ebb1f1bcf51f29601188673d7c98e40bdc5e235ff81
protocol.compute_hmac agrees   : True
```
<!-- /GEN -->

Verification order in `open_frame`: **Hamming decode → CRC32/checksum → HMAC.** A chunk that passes CRC but fails HMAC is exactly the signature of a forgery, so it is counted separately and — with Auto Defense on — raises an **INTRUSION ALERT**.

The HMAC comparison uses `hmac.compare_digest` (constant time) so the check itself doesn't leak timing information.

## Where it is in our code
| What | File · function |
|---|---|
| HMAC compute / verify | `protocol.py` · `compute_hmac`, `open_frame` |
| the attacker | `proxy.py` · `forge_chunk`, `Proxy._upstream` |
| `hmac_fail` NACK, forged-chunk counter | `server.py` · `FileServer._handle` |
| intrusion alert + channel-compromised flag | `adaptive.py` · `decide`, `Monitor`; `client.py` · `act` |
| the shared key | `config.py` · `SHARED_KEY` (`ST_KEY` environment variable) |

## Live demo — exact steps
1. Dashboard → Simple → **Hacker attack**, switch **Auto Defense off**, **SEND FILE** (or Advanced preset **4**).  
   **Expected:** orange squares (forged chunks accepted), *0 retransmits*, verdict **FILE TAMPERED — CRC FOOLED**, file in `quarantine/`. Click **Show proof** to see the `HACKED!!` bytes next to the original.
2. Advanced preset **5 Attack + HMAC** (or guided step 5).  
   **Expected:** purple squares, forged chunks rejected and re-sent, verdict **ATTACK BLOCKED**, file in `received/`.
3. CLI: `python proxy.py --mode attack --rate 0.2` → `python client.py sample_files/sample.txt` (exit code 2, rejected) → `... --hmac` (verified).

## Wireshark evidence
* `frame contains "HACKED"` finds the forged chunks. Compare the same SEQ on `tcp.port == 8000` (what the client sent) and `== 9000` (what the server got): the payload and the CRC bytes (offsets 13–16) differ.
* With `--hmac`, FLAGS = `01` and 32 extra bytes sit between the 17-byte header and the payload. `frame contains "hmac_fail"` shows the NACKs.

## Linked test cases
`U9` forgery fools CRC · `U10` forgery caught by HMAC (with and without FEC) · `U11` wrong key rejected · `I7` MITM against CRC-only → file corrupted, 0 retransmits · `I8` HMAC blocks the attack · `L6`, `L7` Auto Defense alert / quarantine / retry · `Q1` manual mode: fooled but quarantined.

## Limitations (be honest)
* HMAC gives **integrity and authenticity, not confidentiality** — the data is still readable on the wire.
* The key is pre-shared and configured in an environment variable; a real system would use TLS or a key exchange.
* No nonce: an attacker could replay a complete, valid recorded session. TLS prevents this.
* The attacker in this demo only alters DATA frames. Without HMAC a cleverer attacker could also rewrite the expected SHA-256 in the META frame (see doc 07); with HMAC, META is authenticated too.

## Likely viva questions
1. **Why can't the attacker forge an HMAC?** It needs the secret key; without it, producing a valid tag is as hard as breaking SHA-256.
2. **Why is CRC not enough?** CRC is a public algorithm: the attacker changes the data and recomputes it, exactly as our proxy does.
3. **Is HMAC the same as encryption?** No. It proves the data wasn't altered and came from a key holder; it doesn't hide the data.
