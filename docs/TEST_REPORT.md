# Test report

Run: `python -m pytest tests/ -v` -- **102 / 102 passed**.

## A. Protocol unit tests (`tests/test_protocol.py`)

| ID | Test | Condition | Expected |
|---|---|---|---|
| U1 | `test_protocol.TestHamming.test_roundtrip_all_bytes` | all 256 byte values, no errors | decoded = original, 0 corrections |
| U2 | `test_protocol.TestHamming.test_corrects_every_single_bit_position` | every one of 7 bit positions x 16 nibbles | original nibble recovered |
| U3 | `test_protocol.TestHamming.test_corrects_one_error_per_codeword` | 4 KB, one flip in each of 8192 codewords | all corrected |
| U4 | `test_protocol.TestHamming.test_two_bit_error_is_not_silently_trusted` | 2 flips in one codeword | mis-correction caught by check |
| U5 | `test_protocol.TestFrames.test_roundtrip_all_flag_combinations` | all 4 HMAC/FEC combinations | data, seq and status `ok` |
| U6 | `test_protocol.TestFrames.test_checksum_detects_bit_flip` | 1 bit flipped, no FEC | detected as bad |
| U7 | `test_protocol.TestFrames.test_fec_corrects_bit_flip` | 1 bit flipped, FEC on | `corrected`, 1 bit fixed |
| U8 | `test_protocol.TestFrames.test_bad_magic_rejected` | header starts `XX` | `ProtocolError` |
| U9 | `test_protocol.TestAttack.test_forgery_fools_crc_without_hmac` | MITM rewrites data + CRC | accepted as `ok`, data contains `HACKED!!` |
| U10 | `test_protocol.TestAttack.test_forgery_caught_by_hmac` | same, HMAC on | `hmac_fail` |
| U11 | `test_protocol.TestAttack.test_wrong_key_rejected` | sender uses a different key | `hmac_fail` |
| U12 | `test_protocol.TestAttack.test_flip_bits_changes_payload` | noise injector | payload changes |

## B. Integration tests (`tests/test_integration.py`) -- real sockets through the proxy

File: 100 KB + 123 B (not a multiple of the chunk size).

| ID | Test | Channel | Expected |
|---|---|---|---|
| I1 | `test_integration.TestTransfer.test_01_clean_transfer` | clean | SHA-256 match, 0 retransmits |
| I2 | `test_integration.TestTransfer.test_02_direct_to_server` | no proxy | SHA-256 match |
| I3 | `test_integration.TestTransfer.test_03_empty_file` | clean | SHA-256 match |
| I4 | `test_integration.TestTransfer.test_10_noise_detected_and_retransmitted` | 30% chunks, 1-bit | failures detected, retransmits, file correct |
| I5 | `test_integration.TestTransfer.test_11_hamming_corrects_without_retransmit` | 30%, 1-bit, FEC | 0 retransmits, chunks corrected, file correct |
| I6 | `test_integration.TestTransfer.test_12_hamming_burst_falls_back_to_retransmit` | 30%, 3-bit burst, FEC | FEC cannot fix, retransmit, file correct |
| I7 | `test_integration.TestTransfer.test_20_attack_fools_crc` | 20% forged | file corrupted, 0 retransmits (CRC fooled) |
| I8 | `test_integration.TestTransfer.test_21_hmac_blocks_attack` | 20% forged, HMAC | HMAC failures > 0, file correct |
| I9 | `test_integration.TestTransfer.test_30_frame_loss_recovered_by_timeout` | 5% frames dropped | timeouts trigger retransmit, file correct |
| I10 | `test_integration.TestTransfer.test_31_latency_increases_rtt` | +5 ms | RTT increases by > 3 ms |
| I11 | `test_integration.TestTransfer.test_40_server_down` | nothing listening | clean `TransferError`, no crash |
| I12 | `test_integration.TestTransfer.test_41_retry_limit` | 100% corruption, 3 retries | gives up with `TransferError` |

## C. Checksum mode and word swap (`tests/test_checksum.py`)

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
| C11 | `test_checksum.TestChecksumFrames.test_version_1_with_hmac_verifies_against_its_own_header` | v1 frame with HMAC | HMAC verified |
| C12 | `test_checksum.TestChecksumFrames.test_future_version_rejected` | version 9 | `ProtocolError` |
| C13 | `test_checksum.TestChecksumFrames.test_hamming_fix_details_report_syndrome` | flip in codeword #3 | syndrome 6, byte 1, low nibble |
| C14 | `test_checksum.TestWordSwap.test_swap_fools_checksum16_but_not_crc32` | two 16-bit words swapped | checksum unchanged, CRC32 changed |
| C15 | `test_checksum.TestWordSwap.test_swap_needs_two_different_words` | identical words / tiny chunk | no swap performed |
| C16 | `test_checksum.TestSwapThroughProxy.test_checksum_is_fooled_by_reordering` | proxy swap pattern, checksum16 | file corrupted, 0 retransmits |
| C17 | `test_checksum.TestSwapThroughProxy.test_crc32_catches_the_same_reordering` | same, CRC32 | `crc_fail` > 0, file verified |
| C18 | `test_checksum.TestSwapThroughProxy.test_checksum_still_catches_random_bit_flips` | random 1-bit noise, checksum16 | `checksum_fail` = retransmits, file verified |

## D. Auto Defense rules engine (`tests/test_adaptive.py`, no sockets)

| ID | Test | Rule | Expected |
|---|---|---|---|
| R1 | `test_adaptive.TestRulesEngine.test_clean_link_no_action` | -- | no decision |
| R2 | `test_adaptive.TestRulesEngine.test_empty_history_no_action` | -- | no decision |
| R3 | `test_adaptive.TestRulesEngine.test_noisy_link_enables_fec` | Hamming on | 20% failures, FEC off -> `fec_on` |
| R4 | `test_adaptive.TestRulesEngine.test_single_failure_is_not_noise` | Hamming on | one failure never triggers |
| R5 | `test_adaptive.TestRulesEngine.test_too_few_samples_no_decision` | Hamming on | < 10 samples -> no decision |
| R6 | `test_adaptive.TestRulesEngine.test_below_threshold_no_action` | Hamming on | exactly 10% triggers, 2 in 21 does not |
| R7 | `test_adaptive.TestRulesEngine.test_burst_errors_halve_chunk` | smaller chunks | FEC on and failing -> 1024 -> 512 B |
| R8 | `test_adaptive.TestRulesEngine.test_chunk_size_floor` | smaller chunks | never below 256 B |
| R9 | `test_adaptive.TestRulesEngine.test_clean_again_disables_fec` | Hamming off | 30 clean transmissions -> `fec_off` |
| R10 | `test_adaptive.TestRulesEngine.test_fec_stays_on_while_errors_are_still_being_corrected` | Hamming off | corrections in window -> stays on |
| R11 | `test_adaptive.TestRulesEngine.test_fec_off_rule_needs_fec_on` | Hamming off | FEC already off -> no decision |
| R12 | `test_adaptive.TestRulesEngine.test_hmac_failure_raises_intrusion_alert` | intrusion alert | alert names the chunk |
| R13 | `test_adaptive.TestRulesEngine.test_alert_is_raised_once` | intrusion alert | already compromised -> no second alert |
| R14 | `test_adaptive.TestRulesEngine.test_give_up_after_n_failures_on_one_chunk` | give up | 8 failures on one chunk -> `give_up` |
| R15 | `test_adaptive.TestRulesEngine.test_failures_on_different_chunks_do_not_count_as_consecutive` | give up | spread failures never give up |
| R16 | `test_adaptive.TestRulesEngine.test_timeouts_count_towards_give_up` | give up | 8 timeouts -> `give_up` |
| R17 | `test_adaptive.TestRulesEngine.test_sha_mismatch_without_hmac_retries_with_hmac` | verify | `retry_with_hmac` |
| R18 | `test_adaptive.TestRulesEngine.test_no_retry_when_verified_or_already_hmac_or_out_of_attempts` | verify | no retry if verified or HMAC already on |
| R19 | `test_adaptive.TestRulesEngine.test_monitor_applies_decision_and_clears_history` | monitor | decision applied, history reset |
| R20 | `test_adaptive.TestRulesEngine.test_monitor_remembers_forged_chunks` | monitor | forged chunk numbers listed |

## E. Auto Defense closed loop (`tests/test_adaptive.py`) -- fresh server + proxy per test

| ID | Test | Scenario | Expected |
|---|---|---|---|
| L1 | `test_adaptive.TestClosedLoop.test_clean_link_takes_no_action` | clean link, auto | verified, no decisions |
| L2 | `test_adaptive.TestClosedLoop.test_noisy_link_enables_hamming_automatically` | 30% noise, 1-bit | `fec_on`, Hamming repairs, verified |
| L3 | `test_adaptive.TestClosedLoop.test_auto_beats_plain_crc_arq_on_retransmits` | same noise, auto vs manual | fewer retransmits with Auto |
| L4 | `test_adaptive.TestClosedLoop.test_burst_errors_shrink_the_chunk_size` | 30%, 3-bit bursts | `fec_on` then `halve_chunk`, file intact |
| L5 | `test_adaptive.TestClosedLoop.test_link_recovers_and_hamming_turns_off_again` | noisy, healing after 60 frames | `fec_on` then `fec_off`, verified |
| L6 | `test_adaptive.TestClosedLoop.test_attack_without_hmac_is_quarantined_then_resent_with_hmac` | attack, HMAC off | quarantined, retry with HMAC, verified |
| L7 | `test_adaptive.TestClosedLoop.test_attack_with_hmac_from_the_start_raises_alert_without_quarantine` | attack, HMAC on | alert, nothing quarantined |
| L8 | `test_adaptive.TestClosedLoop.test_giving_up_quarantines_the_partial_file` | 100% corruption | `TransferError`, partial file quarantined |

## F. Quarantine (`tests/test_adaptive.py`)

| ID | Test | Scenario | Expected |
|---|---|---|---|
| Q1 | `test_adaptive.TestNoBadFileInReceived.test_manual_mode_still_shows_crc_being_fooled_but_file_is_quarantined` | attack, manual | CRC fooled, file quarantined |
| Q2 | `test_adaptive.TestNoBadFileInReceived.test_sidecar_explains_the_rejection` | same | JSON sidecar: reason `sha256_mismatch` |
| Q3 | `test_adaptive.TestNoBadFileInReceived.test_dropped_connection_quarantines_partial_upload` | client disconnects | partial file quarantined |

## G. Numerical solvers (`tests/test_numericals.py`)

| ID | Test | Expected |
|---|---|---|
| N1 | `test_numericals.TestChecksumSolver.test_textbook_example` | checksum `11011111` |
| N2 | `test_numericals.TestChecksumSolver.test_matches_protocol_for_16_bit_words` | equals `protocol.internet_checksum16` |
| N3 | `test_numericals.TestChecksumSolver.test_text_input_hello` | `HELLO` padded, equals protocol |
| N4 | `test_numericals.TestChecksumSolver.test_receiver_accepts_clean_and_rejects_any_single_flip` | every single flip rejected |
| N5 | `test_numericals.TestChecksumSolver.test_swapping_two_words_fools_checksum_but_crc_catches_it` | verdict "undetected", CRC differs |
| N6 | `test_numericals.TestChecksumSolver.test_every_addition_step_is_internally_consistent` | sum row equals independent arithmetic |
| N7 | `test_numericals.TestCrcSolver.test_textbook_example` | CRC `100`, codeword matches |
| N8 | `test_numericals.TestCrcSolver.test_long_division_equals_shift_register_crc` | 100 random messages x 4 generators |
| N9 | `test_numericals.TestCrcSolver.test_crc8_known_check_value` | CRC-8 of `123456789` = `0xF4` |
| N10 | `test_numericals.TestCrcSolver.test_codeword_is_divisible_by_generator` | remainder of codeword is 0 |
| N11 | `test_numericals.TestCrcSolver.test_every_single_bit_flip_is_rejected` | CRC-3/4/8, every position |
| N12 | `test_numericals.TestCrcSolver.test_error_equal_to_generator_multiple_is_undetectable` | verdict "undetected" |
| N13 | `test_numericals.TestCrcSolver.test_crc32_matches_zlib_and_protocol` | Lab value = zlib = protocol |
| N14 | `test_numericals.TestCrcSolver.test_crc32_by_division_equals_zlib` | long-division CRC-32 = `zlib.crc32` |
| N15 | `test_numericals.TestCrcSolver.test_crc32_receiver_detects_flip` | flipped bit -> reject |
| N16 | `test_numericals.TestCrcSolver.test_polynomial_strings` | `1011` -> x^3 + x + 1 |
| N17 | `test_numericals.TestHammingSolver.test_textbook_example_codeword_and_correction` | `0110011`, flip 6 -> syndrome 6 -> corrected |
| N18 | `test_numericals.TestHammingSolver.test_codeword_equals_protocol_for_every_nibble` | equals `hamming74_encode_nibble` x16 |
| N19 | `test_numericals.TestHammingSolver.test_single_flip_syndrome_and_decode_equal_protocol` | syndrome/decode equal protocol (16 x 7) |
| N20 | `test_numericals.TestHammingSolver.test_two_bit_errors_are_miscorrected` | all 16 x 21 pairs "miscorrected" |
| N21 | `test_numericals.TestHammingSolver.test_general_mode_12_8` | (12,8), every single flip corrected |
| N22 | `test_numericals.TestHammingSolver.test_odd_parity_works` | all 7 single flips corrected |
| N23 | `test_numericals.TestHammingSolver.test_number_of_parity_bits_formula` | smallest r with 2^r >= m + r + 1 |
| N24 | `test_numericals.TestHammingSolver.test_74_requires_exactly_four_bits` | other lengths -> `ValueError` |
| N25 | `test_numericals.TestInputsAndExamples.test_parsing` | text / hex / binary parsing |
| N26 | `test_numericals.TestInputsAndExamples.test_bad_input_is_a_value_error` | bad input -> clear error |
| N27 | `test_numericals.TestInputsAndExamples.test_all_random_examples_solve_and_accept` | 120 random examples solve |
| N28 | `test_numericals.TestInputsAndExamples.test_flips_toggle_and_ignore_out_of_range` | flips toggle, invalid indices ignored |
| N29 | `test_numericals.TestInputsAndExamples.test_render_text_is_generated_from_the_solution` | docs text comes from the solver |

## H. Performance

See `results/` (generated by `bench.py`): error-rate sweep, latency, chunk size, attack,
Auto Defense vs fixed protection, checksum16 vs CRC32 detection, frame loss.
