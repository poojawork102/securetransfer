# 07 · SHA-256 end-to-end verification and quarantine

## In one line
After the last chunk the server hashes the *whole* assembled file and compares it with the hash the client announced; only a match lets the file into `received/` — anything else is locked in `quarantine/`.

## The problem it solves (real-life example)
You photocopy a 60-page contract page by page and each page looks fine. Before you sign, you count the pages and compare a stamp number printed on the original: a missing page, a duplicated page or a page swapped by someone in the copy shop shows up *only* at that final whole-document check. Per-chunk checks look at each page; SHA-256 looks at the document.

## How it works
1. The client computes `SHA-256(file)` up front and sends it in the **META** frame.
2. The server writes incoming chunks to a staging file (`received/.incoming/…`), **not** to `received/`.
3. On **DONE** the server computes SHA-256 of the staging file.
4. **Match** → `os.replace` the file into `received/`. **Mismatch** (or the connection died half-way) → move it to `quarantine/<name>.<timestamp>.rejected` and write `<same name>.json` explaining why. A bad file therefore *never* appears in `received/`.
5. The server answers with `RESULT {match, expected, got, path, quarantined}`.

A hash is an *avalanche* function — change one character and about half of the 256 output bits flip, so any difference is obvious:

<!-- GEN:sha256_example -->
```text
Pay Pooja 100 rupees   -> 24b6328bbc2bd8985e986b8a22b6b06e0a9b7b872326371a8fc5c518b28b15a8
Pay Pooja 900 rupees   -> 5e2150bb9f1025c06edcb80d139054466d78306b880b0c7c3217cd240722af24
one character changed -> 127 of 256 hash bits differ (avalanche effect)
```
<!-- /GEN -->

**What a quarantined file leaves behind** — the sidecar JSON next to it:

```json
{
  "file": "sample.txt",
  "reason": "sha256_mismatch",
  "time": "2026-10-11 16:03:41",
  "expected_sha256": "…hash announced by the client…",
  "got_sha256": "…hash of what actually arrived…",
  "expected_size": 65536,
  "got_size": 65536,
  "chunks_received": 64,
  "stats": { "ok": 64, "corrected": 0, "crc_fail": 0, "checksum_fail": 0, "hmac_fail": 0, "bits_fixed": 0 }
}
```
(The keys are exactly those written by `FileServer._quarantine`.)

### What SHA-256 does and doesn't prove
| Question | Answer |
|---|---|
| Detects accidental damage / reordered / missing chunks? | ✅ |
| Detects a tampered file? | ✅ **only if the expected hash itself is trustworthy.** The hash travels in the META frame; without HMAC an attacker who also rewrites META could make a tampered file "match". Our demo attacker only touches DATA, so the mismatch is caught. With HMAC on, META is authenticated too. |
| Repairs anything? | ❌ — the answer is quarantine and (with Auto Defense) a full re-send with HMAC. |

This is the **verify** step that closes the loop in doc 08: it is the only place the CRC-fooling attack is caught when HMAC is off.

## Where it is in our code
| What | File · function |
|---|---|
| hash computed before sending | `client.py` · `send_file` |
| staging, final comparison, move, sidecar | `server.py` · `FileServer._handle` (DONE branch), `_quarantine` |
| partial file on a dropped connection | `server.py` · `_handle` (`except` branch) |
| "Show proof" byte diff | `dashboard/app.py` · `diff_regions`, `/api/proof` |

## Live demo — exact steps
* Simple → **Hacker attack**, Auto Defense **off** → SEND. **Expected:** verdict **FILE TAMPERED — CRC FOOLED**; a new `*.rejected` + `*.rejected.json` pair in `quarantine/`; nothing new in `received/`.
* Click **Show proof**: a side-by-side hex/ASCII diff of the original and the quarantined copy with the `HACKED!!` bytes highlighted.
* Turn Auto Defense **on** and send again: the first copy is quarantined, the client re-sends with HMAC, the second copy lands in `received/` (guided step 4).

## Wireshark evidence
The `RESULT` frame (type `06`) on the server→client direction carries the JSON with `"match": false` and both hashes in clear text: `frame contains "sha256_mismatch"` won't appear on the wire (that's server-side), but `frame contains "\"match\": false"` will.

## Linked test cases
`Q1` manual mode: tampered file is rejected and quarantined, never in `received/` · `Q2` sidecar explains the rejection · `Q3` dropped connection quarantines the partial file · `L6` quarantine then retry with HMAC · `L8` giving up quarantines the partial file · `I7` CRC fooled → file corrupted.

## Limitations
The announced hash must be authenticated (HMAC/TLS) to defend against an active attacker; hashing a large file happens after the last chunk (fine here, a streaming design would hash incrementally).

## Likely viva questions
1. **If every chunk passed CRC, why check the whole file?** Chunk checks can be fooled (forgery) or miss a missing/duplicated/reordered chunk; the whole-file hash is the end-to-end proof.
2. **Where does the file go if the hash doesn't match?** `quarantine/`, with a JSON sidecar; it is never moved to `received/`.
3. **Can an attacker beat SHA-256?** Not by finding a colliding file, but if he can also change the *expected* hash in transit he doesn't need to — which is why the hash must travel inside an authenticated (HMAC'd) frame.
