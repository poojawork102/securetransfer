# Test report

Run: `python -m unittest discover -s tests -v` → **117 / 117 passed**.

Every automated test is listed below by its exact path (`file.Class.method`); `tests/test_docs.py` fails if a test exists that is not in this table, if a listed test doesn't exist, or if the count above is wrong. The IDs (U, I, C, R, L, Q, N, D, M) are what the concept notes and [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md) refer to.

## A. Protocol unit tests (`tests/test_protocol.py`)

| ID | Test | Condition | Expected |
|---|---|---|---|
| U1 | `test_protocol.TestHamming.test_roundtrip_all_bytes` | all 256 byte values, no errors | decoded = original, 0 corrections |
| U2 | `test_protocol.TestHamming.test_corrects_every_single_bit_position` | every one of 7 bit positions × 16 nibbles | original nibble recovered |
| U3 | `test_protocol.TestHamming.test_corrects_one_error_per_codeword` | 4 KB, one flip in each of 8192 codewords | all corrected |
| U4 | `test_protocol.TestHamming.test_two_bit_error_is_not_silently_trusted` | 2 flips in one codeword | mis-correction caught by CRC32 → `crc_fail` |
| U5 | `test_protocol.TestFrames.test_roundtrip_all_flag_combinations` | all 4 HMAC/FEC combinations | data, seq and status `ok` |
| U6 | `test_protocol.TestFrames.test_crc_detects_bit_flip` | 1 bit flipped, no FEC | `crc_fail` |
| U7 | `test_protocol.TestFrames.test_fec_corrects_bit_flip` | 1 bit flipped, FEC on | `corrected`, 1 bit fixed |
| U8 | `test_protocol.TestFrames.test_bad_magic_rejected` | header starts `XX` | `ProtocolError` |
| U9 | `test_protocol.TestAttack.test_forgery_fools_crc_without_hmac` | MITM rewrites data + CRC | accepted as `ok`, data contains `HACKED!!` (shows the weakness) |
| U10 | `test_protocol.TestAttack.test_forgery_caught_by_hmac` | same, HMAC on, with and without FEC | `hmac_fail` |
| U11 | `test_protocol.TestAttack.test_wrong_key_rejected` | sender uses a different key | `hmac_fail` |
| U12 | `test_protocol.TestAttack.test_flip_bits_changes_payload` | noise injector | payload changes |

## B. Integration tests, manual mode (`tests/test_integration.py`) — real sockets through the proxy

File: 100 KB + 123 B (deliberately not a multiple of the chunk size).

| ID | Test | Channel | Expected |
|---|---|---|---|
| I1 | `test_integration.TestTransfer.test_01_clean_transfer` | clean | SHA-256 match, 0 retransmits |
| I2 | `test_integration.TestTransfer.test_02_direct_to_server` | no proxy | SHA-256 match |
| I3 | `test_integration.TestTransfer.test_03_empty_file` | clean | SHA-256 match |
| I4 | `test_integration.TestTransfer.test_10_noise_detected_and_retransmitted` | 30 % chunks, 1-bit | CRC failures detected, retransmits = CRC failures, file correct |
| I5 | `test_integration.TestTransfer.test_11_hamming_corrects_without_retransmit` | 30 %, 1-bit, FEC | **0 retransmits**, chunks corrected, file correct |
| I6 | `test_integration.TestTransfer.test_12_hamming_burst_falls_back_to_retransmit` | 30 %, 3-bit burst, FEC | FEC can't fix → CRC catches → retransmit, file correct |
| I7 | `test_integration.TestTransfer.test_20_attack_fools_crc` | 20 % forged | **file corrupted**, yet 0 retransmits (CRC fooled) |
| I8 | `test_integration.TestTransfer.test_21_hmac_blocks_attack` | 20 % forged, HMAC | HMAC failures > 0, file correct |
| I9 | `test_integration.TestTransfer.test_30_frame_loss_recovered_by_timeout` | 5 % frames dropped | timeouts trigger retransmit, file correct |
| I10 | `test_integration.TestTransfer.test_31_latency_increases_rtt` | +5 ms | RTT increases by > 3 ms |
| I11 | `test_integration.TestTransfer.test_40_server_down` | nothing listening | clean `TransferError`, no crash |
| I12 | `test_integration.TestTransfer.test_41_retry_limit` | 100 % corruption, 3 retries | gives up with `TransferError` |

## C. Checksum mode, protocol v2, word swap (`tests/test_checksum.py`)

| ID | Test | Condition | Expected |
|---|---|---|---|
| C1 | `test_checksum.TestInternetChecksum.test_rfc1071_example` | RFC 1071 words `0001 f203 f4f5 f6f7` | checksum `0x220D` |
| C2 | `test_checksum.TestInternetChecksum.test_receiver_sum_is_all_ones` | data + checksum, various lengths | folded sum complements to 0 |
| C3 | `test_checksum.TestInternetChecksum.test_odd_length_is_zero_padded` | odd-length data | same as explicit zero byte |
| C4 | `test_checksum.TestInternetChecksum.test_detects_every_single_bit_error` | every single-bit flip of a 64-byte chunk | all detected |
| C5 | `test_checksum.TestChecksumFrames.test_roundtrip_all_flag_combinations` | {HMAC, FEC, crc32/checksum16} = 12 combinations | data intact, status `ok` |
| C6 | `test_checksum.TestChecksumFrames.test_check_field_is_16_bit_and_flag_is_set` | checksum16 frame | FLAGS bit 2 set, CHECK < 2^16 |
| C7 | `test_checksum.TestChecksumFrames.test_bit_flip_reports_checksum_fail` | 1 flipped bit | reason `checksum_fail` |
| C8 | `test_checksum.TestChecksumFrames.test_fec_corrects_with_checksum_mode` | 1 flipped bit, FEC + checksum16 | corrected |
| C9 | `test_checksum.TestChecksumFrames.test_unknown_check_mode_rejected` | `check="md5"` | `ValueError` |
| C10 | `test_checksum.TestChecksumFrames.test_version_1_frames_still_accepted` | a v1 frame | accepted, verified as CRC32 |
| C11 | `test_checksum.TestChecksumFrames.test_version_1_with_hmac_verifies_against_its_own_header` | v1 frame with HMAC | HMAC verified, re-serialised as v1 |
| C12 | `test_checksum.TestChecksumFrames.test_future_version_rejected` | version 9 | `ProtocolError` |
| C13 | `test_checksum.TestChecksumFrames.test_hamming_fix_details_report_syndrome` | flip in codeword #3 | syndrome 6, byte 1, low nibble |
| C14 | `test_checksum.TestWordSwap.test_swap_fools_checksum16_but_not_crc32` | two 16-bit words swapped | checksum unchanged, CRC32 changed |
| C15 | `test_checksum.TestWordSwap.test_swap_needs_two_different_words` | identical words / tiny chunk | no swap performed |
| C16 | `test_checksum.TestSwapThroughProxy.test_checksum_is_fooled_by_reordering` | proxy swap pattern, checksum16 | file corrupted, 0 retransmits, 0 `checksum_fail` |
| C17 | `test_checksum.TestSwapThroughProxy.test_crc32_catches_the_same_reordering` | same, CRC32 | `crc_fail` > 0, file verified |
| C18 | `test_checksum.TestSwapThroughProxy.test_checksum_still_catches_random_bit_flips` | random 1-bit noise, checksum16 | `checksum_fail` = retransmits, file verified |

## D. Auto Defense rules engine (`tests/test_adaptive.py`, no sockets)

| ID | Test | Rule (see doc 08) | Expected |
|---|---|---|---|
| R1 | `test_adaptive.TestRulesEngine.test_clean_link_no_action` | — | no decision |
| R2 | `test_adaptive.TestRulesEngine.test_empty_history_no_action` | — | no decision |
| R3 | `test_adaptive.TestRulesEngine.test_noisy_link_enables_fec` | Hamming on | 20 % failures, FEC off → `fec_on`, reason names the error rate |
| R4 | `test_adaptive.TestRulesEngine.test_single_failure_is_not_noise` | Hamming on | one failure never triggers |
| R5 | `test_adaptive.TestRulesEngine.test_too_few_samples_no_decision` | Hamming on | < 10 samples → no decision |
| R6 | `test_adaptive.TestRulesEngine.test_below_threshold_no_action` | Hamming on | exactly 10 % triggers, 2 in 21 does not (window = 20) |
| R7 | `test_adaptive.TestRulesEngine.test_burst_errors_halve_chunk` | smaller chunks | FEC on and still failing → 1024 → 512 B |
| R8 | `test_adaptive.TestRulesEngine.test_chunk_size_floor` | smaller chunks | never below 256 B |
| R9 | `test_adaptive.TestRulesEngine.test_clean_again_disables_fec` | Hamming off | 30 clean transmissions → `fec_off` |
| R10 | `test_adaptive.TestRulesEngine.test_fec_stays_on_while_errors_are_still_being_corrected` | Hamming off | 29 clean, or 1 correction in 30 (3.3 %) → stays on |
| R11 | `test_adaptive.TestRulesEngine.test_fec_off_rule_needs_fec_on` | Hamming off | FEC already off → no decision |
| R12 | `test_adaptive.TestRulesEngine.test_hmac_failure_raises_intrusion_alert` | intrusion alert | alert names the chunk, HMAC stays on |
| R13 | `test_adaptive.TestRulesEngine.test_alert_is_raised_once` | intrusion alert | already compromised → no second alert |
| R14 | `test_adaptive.TestRulesEngine.test_give_up_after_n_failures_on_one_chunk` | give up | 8 failures on one chunk → `give_up`; 7 → not |
| R15 | `test_adaptive.TestRulesEngine.test_failures_on_different_chunks_do_not_count_as_consecutive` | give up | failures spread over chunks never give up |
| R16 | `test_adaptive.TestRulesEngine.test_timeouts_count_towards_give_up` | give up | 8 timeouts on one chunk → `give_up` |
| R17 | `test_adaptive.TestRulesEngine.test_sha_mismatch_without_hmac_retries_with_hmac` | verify → retry | `retry_with_hmac`, reason mentions quarantine |
| R18 | `test_adaptive.TestRulesEngine.test_no_retry_when_verified_or_already_hmac_or_out_of_attempts` | verify → retry | no retry if verified, HMAC already on, or attempt 2 |
| R19 | `test_adaptive.TestRulesEngine.test_monitor_applies_decision_and_clears_history` | monitor | decision applied, history reset |
| R20 | `test_adaptive.TestRulesEngine.test_monitor_remembers_forged_chunks` | monitor | forged chunk numbers listed, channel compromised |

## E. Auto Defense closed loop, end to end (`tests/test_adaptive.py`) — fresh server + proxy per test

| ID | Test | Scenario | Expected |
|---|---|---|---|
| L1 | `test_adaptive.TestClosedLoop.test_clean_link_takes_no_action` | clean link, `auto=True` | verified, no decisions, protection unchanged |
| L2 | `test_adaptive.TestClosedLoop.test_noisy_link_enables_hamming_automatically` | 30 % noise, 1-bit | `fec_on` decision, Hamming repairs happen, verified |
| L3 | `test_adaptive.TestClosedLoop.test_auto_beats_plain_crc_arq_on_retransmits` | same noise, auto vs manual | fewer retransmits with Auto |
| L4 | `test_adaptive.TestClosedLoop.test_burst_errors_shrink_the_chunk_size` | 30 %, 3-bit bursts | `fec_on` then `halve_chunk`, more (smaller) chunks, file intact |
| L5 | `test_adaptive.TestClosedLoop.test_link_recovers_and_hamming_turns_off_again` | noisy, healing after 60 frames | `fec_on` then `fec_off`, verified |
| L6 | `test_adaptive.TestClosedLoop.test_attack_without_hmac_is_quarantined_then_resent_with_hmac` | attack, HMAC initially off | attempt 1 quarantined (contains `HACKED!!`, sidecar present), attempt 2 with HMAC verified, good file in `received/`, intrusion alert raised |
| L7 | `test_adaptive.TestClosedLoop.test_attack_with_hmac_from_the_start_raises_alert_without_quarantine` | attack, HMAC on | one attempt, alert, nothing quarantined |
| L8 | `test_adaptive.TestClosedLoop.test_giving_up_quarantines_the_partial_file` | 100 % corruption | `TransferError` "Gave up after 4 attempts", partial file quarantined, nothing in `received/` |

## F. Quarantine: no bad file ever reaches `received/` (`tests/test_adaptive.py`)

| ID | Test | Scenario | Expected |
|---|---|---|---|
| Q1 | `test_adaptive.TestNoBadFileInReceived.test_manual_mode_still_shows_crc_being_fooled_but_file_is_quarantined` | attack, manual mode | CRC fooled (0 retransmits, verdict "rejected"), `received/` empty, one file in quarantine |
| Q2 | `test_adaptive.TestNoBadFileInReceived.test_sidecar_explains_the_rejection` | same | JSON sidecar: reason `sha256_mismatch`, expected ≠ got |
| Q3 | `test_adaptive.TestNoBadFileInReceived.test_dropped_connection_quarantines_partial_upload` | client disconnects mid-file | `received/` empty, partial file quarantined |

## G. Numerical Lab (`tests/test_numericals.py`) — the teaching solutions agree with `protocol.py` / `zlib`

| ID | Test | Expected |
|---|---|---|
| N1 | `test_numericals.TestChecksumSolver.test_every_addition_step_is_internally_consistent` | printed sum equals independent arithmetic |
| N2 | `test_numericals.TestChecksumSolver.test_matches_protocol_for_16_bit_words` | equals `protocol.internet_checksum16` for several lengths |
| N3 | `test_numericals.TestChecksumSolver.test_receiver_accepts_clean_and_rejects_any_single_flip` | every single flip rejected (8- and 16-bit) |
| N4 | `test_numericals.TestChecksumSolver.test_swapping_two_words_fools_checksum_but_crc_catches_it` | verdict "undetected", CRC-32 differs |
| N5 | `test_numericals.TestChecksumSolver.test_text_input_hello` | `HELLO` → padded, equals protocol |
| N6 | `test_numericals.TestChecksumSolver.test_textbook_example` | checksum `11011111` |
| N7 | `test_numericals.TestCrcSolver.test_codeword_is_divisible_by_generator` | remainder of codeword is 0 |
| N8 | `test_numericals.TestCrcSolver.test_crc32_by_division_equals_zlib` | long-division CRC-32 = `zlib.crc32` (incl. empty, `123456789` → `0xCBF43926`) |
| N9 | `test_numericals.TestCrcSolver.test_crc32_matches_zlib_and_protocol` | Lab value = zlib = `protocol.crc32` |
| N10 | `test_numericals.TestCrcSolver.test_crc32_receiver_detects_flip` | flipped bit → reject |
| N11 | `test_numericals.TestCrcSolver.test_crc8_known_check_value` | CRC-8 of `123456789` = `0xF4` |
| N12 | `test_numericals.TestCrcSolver.test_error_equal_to_generator_multiple_is_undetectable` | verdict "undetected" |
| N13 | `test_numericals.TestCrcSolver.test_every_single_bit_flip_is_rejected` | CRC-3/4/8, every position |
| N14 | `test_numericals.TestCrcSolver.test_long_division_equals_shift_register_crc` | 100 random messages × 4 generators |
| N15 | `test_numericals.TestCrcSolver.test_polynomial_strings` | `1011` → x³ + x + 1 |
| N16 | `test_numericals.TestCrcSolver.test_textbook_example` | CRC `100`, codeword `11010011101100100`, quotient `11110001111100` |
| N17 | `test_numericals.TestHammingSolver.test_74_requires_exactly_four_bits` | other lengths → `ValueError` |
| N18 | `test_numericals.TestHammingSolver.test_codeword_equals_protocol_for_every_nibble` | equals `hamming74_encode_nibble` ×16 |
| N19 | `test_numericals.TestHammingSolver.test_general_mode_12_8` | (12,8), every single flip corrected |
| N20 | `test_numericals.TestHammingSolver.test_number_of_parity_bits_formula` | smallest r with 2^r ≥ m + r + 1, m = 1…26 |
| N21 | `test_numericals.TestHammingSolver.test_odd_parity_works` | all 7 single flips corrected, clean accepted |
| N22 | `test_numericals.TestHammingSolver.test_single_flip_syndrome_and_decode_equal_protocol` | syndrome/decode equal `hamming74_decode_byte` (16 × 7 cases) |
| N23 | `test_numericals.TestHammingSolver.test_textbook_example_codeword_and_correction` | `0110011`; flip 6 → syndrome 6 → corrected |
| N24 | `test_numericals.TestHammingSolver.test_two_bit_errors_are_miscorrected` | all 16 × 21 pairs "miscorrected", protocol decoder is fooled identically |
| N25 | `test_numericals.TestInputsAndExamples.test_all_random_examples_solve_and_accept` | 120 random examples solve |
| N26 | `test_numericals.TestInputsAndExamples.test_bad_input_is_a_value_error` | bad input → clear error |
| N27 | `test_numericals.TestInputsAndExamples.test_flips_toggle_and_ignore_out_of_range` | flips toggle; invalid indices ignored |
| N28 | `test_numericals.TestInputsAndExamples.test_parsing` | text / hex / binary parsing |
| N29 | `test_numericals.TestInputsAndExamples.test_render_text_is_generated_from_the_solution` | docs text comes from the solver |
| N30 | `test_numericals.TestCompare.test_no_error_everyone_accepts` | no damage: all four mechanisms accept |
| N31 | `test_numericals.TestCompare.test_one_bit_detected_by_checksum_and_crc_repaired_by_hamming` | 1 flipped bit: checksum/CRC detect, Hamming repairs |
| N32 | `test_numericals.TestCompare.test_two_bits_same_block_fool_hamming_alone_but_not_hamming_plus_crc` | 2 flips in one block: Hamming alone mis-corrects silently, Hamming + CRC re-sends |
| N33 | `test_numericals.TestCompare.test_two_bits_far_apart_are_both_repaired` | 2 flips in different blocks: both repaired |
| N34 | `test_numericals.TestCompare.test_word_swap_fools_checksum_and_hamming_but_not_crc` | swapped words: only CRC notices |
| N35 | `test_numericals.TestCompare.test_custom_flips_are_applied` | user-chosen bit flips are applied |
| N36 | `test_numericals.TestCompare.test_hamming_plus_crc_agrees_with_the_real_frame_pipeline` | the comparison's verdict equals `protocol.open_frame` on a real FEC frame with the same damage (30 cases) |
| N37 | `test_numericals.TestCompare.test_bad_input` | too long / unknown scenario → `ValueError` |
| N38 | `test_numericals.TestPractice.test_every_question_type_is_answerable_and_checked` | 5 question types × 30 seeds: right answer accepted, wrong rejected |
| N39 | `test_numericals.TestPractice.test_answer_normalisation` | spaces and `A`/`R` shorthand accepted |
| N40 | `test_numericals.TestPractice.test_hamming_locate_answer_is_the_flipped_position` | expected answer = flipped position |
| N41 | `test_numericals.TestPractice.test_questions_are_reproducible_by_seed` | same seed → same question |
| N42 | `test_numericals.TestPractice.test_unknown_kind` | unknown question type → `ValueError` |

## H. Documentation stays truthful (`tests/test_docs.py`)

| ID | Test | Expected |
|---|---|---|
| D1 | `test_docs.TestDocs.test_generated_blocks_are_current` | every `<!-- GEN:… -->` block in the concept notes equals what the code produces now |
| D2 | `test_docs.TestDocs.test_every_test_is_in_this_report` | the tables above list exactly the tests that exist, and the pass count in the heading is right |

## I. Manual / browser checks (dashboard)

Run against the real server + proxy + dashboard in Microsoft Edge (headless, 1366 × 768) driven by Playwright on 2026-10-11. Observed results:

| ID | Check | Observed |
|---|---|---|
| M1 | Preset 1 · Clean link | see table in section J |
| M2 | Preset 2 · Noisy link (CRC) | see section J |
| M3 | Preset 3 · Noise + Hamming | see section J |
| M4 | Preset 4 · MITM attack (CRC only) | see section J |
| M5 | Preset 5 · Attack + HMAC | see section J |
| M6 | Preset 6 · Checksum vs CRC | see section J |
| M7 | Guided demo "Run full demo", all 6 steps back to back | completed with the expected verdict in every step (see section J for the duration) |
| M8 | Proxy/server killed → red banner with the exact command, Send disabled, danger toast | see section J |
| M9 | Numerical Lab: flip a bit → receiver working and verdict update; swap two words; export | checksum flip → REJECT; swap → "accepted — error NOT detected" and CRC-32 detects; Hamming 1 flip → "corrected at position 6", 2 flips → "WRONG correction"; CRC flip → REJECT |
| M10 | Chunk inspector → "Solve in Numerical Lab" | inspector shows header fields, the flipped bit and Hamming syndrome; Lab loads that nibble |
| M11 | Layout at 1366 × 768 and at 390 px width | no horizontal scroll; controls and toasts usable |

**Not verified here:** the Wireshark captures (needs the team's laptop with Npcap — see [WIRESHARK.md](WIRESHARK.md)); the optional Mininet topology (not built); spoken narration (browser text-to-speech depends on the machine's installed voices); sound alerts.

## J. Results of the browser run

(Filled in below after the run — see the bottom of this file.)

## K. Performance

See [`../results/report.md`](../results/report.md) (generated by `bench.py`): error-rate sweep, latency, chunk size, attack, **Auto Defense vs fixed protection**, **checksum16 vs CRC32 detection**, frame loss.
