# 08 · The closed loop: monitor → decide → act → verify (Auto Defense)

## In one line
The sender watches how the network is behaving, turns protections on and off by rule, and the server's final SHA-256 check decides whether the result may be accepted — so the system adapts *and* never silently accepts a bad file.

## The problem it solves (real-life example)
A driver doesn't wear a winter coat and chains all year: they react — chains on when it snows, off when the road clears — and a final inspection at the destination confirms nothing was damaged. Every protection here costs something (Hamming doubles the bytes, smaller chunks add headers, HMAC adds 32 bytes per frame), so we want *only what the link needs right now*.

## How it works

```
        ┌──────────── monitor ────────────┐
        │ last 20 transmissions: check    │
        │ failures, HMAC failures, bursts,│
        │ timeouts, failures on one chunk │
        └───────────────┬─────────────────┘
                        ▼
                  decide  (adaptive.py — pure rules, unit-tested)
                        ▼
                  act     (Hamming on/off · smaller chunks · alert · give up)
                        ▼
                  verify  (server: whole-file SHA-256; bad file → quarantine)
                        └─ mismatch & HMAC was off → re-send once with HMAC ─┐
        ▲                                                                   │
        └───────────────────────────────────────────────────────────────────┘
```

**Rules** (first match wins; thresholds live in `adaptive.Config`):

| # | Condition (sliding window) | Automatic action | Reason string shown to the user |
|---|---|---|---|
| 1 | Same chunk failed 8 times in a row | Stop; the partial file is quarantined | “Gave up after 8 attempts — link unusable” |
| 2 | Any HMAC failure | Raise INTRUSION ALERT, mark channel compromised, keep HMAC on, log the chunk numbers | “Forged data detected on chunk 14 — channel compromised” |
| 3 | ≥ 10 % check failures (and ≥ 2 of them, over ≥ 10 transmissions), Hamming **off** | Turn Hamming on for subsequent chunks | “Noisy link detected (18 % errors) → Hamming error correction enabled” |
| 4 | Same, but Hamming already **on** (bursts beyond its 1-bit limit) | Halve the chunk size (minimum 256 B) | “Burst errors beyond Hamming's limit → smaller chunks” |
| 5 | < 2 % errors over the last 30 transmissions, Hamming on | Turn Hamming off (saves the 100 % overhead) | “Link is clean again → Hamming disabled to save bandwidth” |
| 6 | Final SHA-256 mismatch and HMAC was off (only possible when the attacker fooled the per-chunk check) | Quarantine the file, re-send the whole file with HMAC, re-verify | “File failed verification → quarantined → resending with HMAC” |

Notes on the details:
* **Flags are per frame**, so Hamming and HMAC can change mid-transfer without the server noticing. The server writes accepted chunks in order, so **chunk size may change too** — `SEQ` is just a counter, and a new size takes effect at the next chunk boundary (never in the middle of a retry, which could lose data after a delayed ACK).
* After any action that changes the settings, the monitor forgets its history so the *new* settings are judged on fresh evidence.
* In our simulator the proxy damages a *percentage of frames* regardless of size, so smaller chunks do not reduce how *often* errors strike — they reduce how much data each error makes us re-send.
* Auto Defense cannot see an attacker who recomputes the CRC until the end (rule 6) — unless HMAC is already on (rule 2). That is the point of demo step 4.

**A timeline replayed through the real rules engine** (a scripted noisy → burst → clean → attack link fed to `adaptive.Monitor`; generated, not typed):

<!-- GEN:timeline_example -->
```text
chunk   7  [fec_on]  Noisy link detected (30% errors) → Hamming error correction enabled
chunk  14  [halve_chunk]  Burst errors beyond Hamming's limit (20% of chunks still failing) → smaller chunks (1024 → 512 B)
chunk  33  [halve_chunk]  Burst errors beyond Hamming's limit (10% of chunks still failing) → smaller chunks (512 → 256 B)
chunk  66  [fec_off]  Link is clean again → Hamming disabled to save bandwidth
chunk  97  [intrusion_alert]  Forged data detected on chunk 97 — channel compromised
final protection: Hamming off, HMAC on, chunk 256 B
```
<!-- /GEN -->

## Where it is in our code
| What | File · function |
|---|---|
| the six rules, thresholds, `Monitor` | `adaptive.py` · `decide`, `decide_after_verify`, `Config`, `Monitor` |
| applying decisions, two attempts, timeline | `client.py` · `_run_attempt` (`act`), `send_file` |
| telemetry event `adapt` → toasts + timeline card | `dashboard/static/js/app.js` · `client:adapt` |
| the "verify" half | `server.py` · quarantine (doc 07) |

## Live demo — exact steps
* Guided demo **step 4** (hacker vs CRC with Auto Defense) and **step 6** (everything changes mid-transfer); or **Run full demo**.
* **Expected in step 6:** timeline entries in this order — Hamming on → chunks halve → (halve again) → Hamming off → intrusion alert → automatic retry with HMAC; toasts bottom-right for each; final verdict **VERIFIED AFTER AUTO-RECOVERY**.
* CLI: `python client.py sample_files/random_256k.bin --auto` against a noisy proxy prints lines such as `AUTO DEFENSE ▶ Noisy link detected (25% errors) → Hamming error correction enabled`, and the final JSON includes `decisions`, `attempts`, `final_protection` and `quarantine_path`.

## Wireshark evidence
Watch the FLAGS byte (offset 4) of successive DATA frames change from `00` to `02` (Hamming on) and back, and the LEN field halve when the chunk size shrinks. After a forged-file rejection a second connection begins with a META whose FLAGS has bit 0 set (`01`/`03`).

## Linked test cases
Rules: `R1`–`R20` (one or more per table row: `R3`–`R6` row 3, `R7`–`R8` row 4, `R9`–`R11` row 5, `R12`–`R13` row 2, `R14`–`R16` row 1, `R17`–`R18` row 6, `R19`–`R20` monitor). Closed loop through a real proxy: `L1` clean → no action · `L2` noise → Hamming on · `L3` auto beats plain CRC/ARQ · `L4` bursts → smaller chunks · `L5` link heals → Hamming off · `L6` attack → quarantine → retry with HMAC → verified · `L7` HMAC from the start → alert, no quarantine · `L8` hopeless link → give up, partial quarantined.

## Limitations
Thresholds are heuristics; decisions lag the channel by a window; one automatic retry only; the simulator's channel is memoryless so it can't reproduce real fading patterns.

## Likely viva questions
1. **What makes this "closed loop"?** The output of the system (error statistics, final verification result) is fed back to change its own behaviour: monitor → decide → act → verify.
2. **Why turn Hamming off when the link is clean?** It doubles the bytes on the wire; we only pay for it while errors justify it.
3. **How can a bad file still never be accepted?** The server only moves a file into `received/` after its SHA-256 matches; everything else is quarantined, regardless of what Auto Defense decided.
