"""
Auto Defense rules engine — the "decide" step of the closed loop  monitor -> decide -> act -> verify.

Everything here is a pure function of its inputs (no sockets, no clock), so each rule can be
unit-tested on its own (tests/test_adaptive.py). client.py feeds it one event per transmission
attempt and applies whatever Decision comes back.

An event is a pair (seq, status) with status one of:
    OK          chunk ACKed, nothing wrong
    CORRECTED   chunk ACKed after Hamming repaired a 1-bit error  (a 1-bit error was seen)
    CHECK_FAIL  CRC32 / checksum mismatch -> NACK                 (noise; with FEC on = burst)
    HMAC_FAIL   CRC passed but HMAC failed -> NACK                (forgery!)
    TIMEOUT     no reply (frame lost)

Rules (first match wins, see the table in README / docs/concepts/08_closed_loop_auto_defense.md):
    give_up         same chunk failed N times in a row                -> stop, quarantine partial file
    intrusion_alert any HMAC failure                                  -> alert, channel compromised
    fec_on          >=10 % check failures in the window, FEC off      -> enable Hamming
    halve_chunk     >=10 % check failures in the window, FEC on       -> halve chunk size (min 256 B)
    fec_off         <2 % errors over the last 30 transmissions, FEC on-> disable Hamming (save 100 % overhead)
And one rule after the whole file was sent:
    retry_with_hmac SHA-256 mismatch and HMAC was off                 -> quarantine, resend with HMAC
"""
from dataclasses import dataclass, replace
from typing import Optional, Sequence, Tuple

OK, CORRECTED, CHECK_FAIL, HMAC_FAIL, TIMEOUT = "ok", "corrected", "check_fail", "hmac_fail", "timeout"
FAILURES = (CHECK_FAIL, HMAC_FAIL, TIMEOUT)

Event = Tuple[int, str]


@dataclass(frozen=True)
class Config:
    window: int = 20             # sliding window: the last 20 transmissions
    error_threshold: float = 0.10    # >= 10 % check failures triggers FEC / smaller chunks
    min_samples: int = 10        # don't judge the link on fewer transmissions than this
    min_failures: int = 2        # ...and never on a single unlucky failure
    clean_run: int = 30          # consecutive transmissions needed to call the link clean again
    clean_rate: float = 0.02     # < 2 % errors over that run = clean
    min_chunk: int = 256         # never shrink chunks below this many bytes
    give_up_after: int = 8       # attempts on ONE chunk before the link is declared unusable


@dataclass(frozen=True)
class Settings:
    """The protection state Auto Defense is allowed to change while a transfer runs."""
    fec: bool
    hmac: bool
    chunk_size: int


@dataclass(frozen=True)
class Metrics:
    samples: int             # transmissions in the window
    check_fails: int         # CRC32 / checksum mismatches in the window
    check_fail_rate: float
    hmac_fails: int
    timeouts: int
    one_bit_fixed: int       # Hamming repaired a single-bit error (not a burst)
    consecutive_fails: int   # failures in a row on the chunk currently being sent
    long_samples: int        # transmissions in the "clean?" window (last 30)
    long_error_rate: float   # errors (check fail / HMAC fail / Hamming fix) over that window

    def as_dict(self):
        return {"window": self.samples, "check_fail_pct": round(self.check_fail_rate * 100, 1),
                "hmac_fails": self.hmac_fails, "timeouts": self.timeouts,
                "one_bit_fixed": self.one_bit_fixed, "consecutive_fails": self.consecutive_fails}


@dataclass(frozen=True)
class Decision:
    action: str              # give_up | intrusion_alert | fec_on | halve_chunk | fec_off | retry_with_hmac
    reason: str              # plain-English sentence shown to the user
    settings: Settings       # protection state AFTER the action
    metrics: Optional[dict] = None


# ---------------------------------------------------------------------------
# Monitor: turn the recent history into numbers
# ---------------------------------------------------------------------------
def compute_metrics(history: Sequence[Event], cfg: Config = Config()) -> Metrics:
    recent = list(history)[-cfg.window:]
    long = list(history)[-cfg.clean_run:]
    n = len(recent)
    check_fails = sum(1 for _, s in recent if s == CHECK_FAIL)
    errors_long = sum(1 for _, s in long if s in (CHECK_FAIL, HMAC_FAIL, CORRECTED))

    consecutive = 0
    if history:
        last_seq = history[-1][0]
        for seq, s in reversed(history):
            if seq != last_seq or s not in FAILURES:
                break
            consecutive += 1

    return Metrics(
        samples=n,
        check_fails=check_fails,
        check_fail_rate=check_fails / n if n else 0.0,
        hmac_fails=sum(1 for _, s in recent if s == HMAC_FAIL),
        timeouts=sum(1 for _, s in recent if s == TIMEOUT),
        one_bit_fixed=sum(1 for _, s in recent if s == CORRECTED),
        consecutive_fails=consecutive,
        long_samples=len(long),
        long_error_rate=errors_long / len(long) if long else 0.0,
    )


# ---------------------------------------------------------------------------
# Decide: the rules table
# ---------------------------------------------------------------------------
def decide(history: Sequence[Event], settings: Settings, cfg: Config = Config(),
           compromised: bool = False) -> Optional[Decision]:
    """Return the action to take now, or None if the link is fine."""
    if not history:
        return None
    m = compute_metrics(history, cfg)
    md = m.as_dict()
    last_seq, last_status = history[-1]

    if m.consecutive_fails >= cfg.give_up_after:
        return Decision("give_up", f"Gave up after {m.consecutive_fails} attempts — link unusable",
                        settings, md)

    if last_status == HMAC_FAIL and not compromised:
        return Decision("intrusion_alert",
                        f"Forged data detected on chunk {last_seq} — channel compromised",
                        settings, md)

    noisy = (m.samples >= cfg.min_samples and m.check_fails >= cfg.min_failures
             and m.check_fail_rate >= cfg.error_threshold)

    if noisy and not settings.fec:
        return Decision("fec_on",
                        f"Noisy link detected ({m.check_fail_rate:.0%} errors) → Hamming error correction enabled",
                        replace(settings, fec=True), md)

    if noisy and settings.fec and settings.chunk_size > cfg.min_chunk:
        new = max(cfg.min_chunk, settings.chunk_size // 2)
        return Decision("halve_chunk",
                        f"Burst errors beyond Hamming's limit ({m.check_fail_rate:.0%} of chunks still failing) "
                        f"→ smaller chunks ({settings.chunk_size} → {new} B)",
                        replace(settings, chunk_size=new), md)

    if (settings.fec and m.long_samples >= cfg.clean_run and m.long_error_rate < cfg.clean_rate):
        return Decision("fec_off",
                        "Link is clean again → Hamming disabled to save bandwidth",
                        replace(settings, fec=False), md)
    return None


def decide_after_verify(verified: bool, settings: Settings, attempt: int,
                        max_attempts: int = 2) -> Optional[Decision]:
    """The 'verify' step of the loop: what to do when the whole-file SHA-256 does not match.
    Without HMAC the only possible cause is undetected tampering/corruption, so resend once with HMAC."""
    if verified or attempt >= max_attempts or settings.hmac:
        return None
    return Decision("retry_with_hmac", "File failed verification → quarantined → resending with HMAC",
                    replace(settings, hmac=True))


# ---------------------------------------------------------------------------
# Monitor + Decide in one small stateful helper used by client.py
# ---------------------------------------------------------------------------
class Monitor:
    def __init__(self, settings: Settings, cfg: Config = Config()):
        self.settings, self.cfg = settings, cfg
        self.history = []
        self.compromised = False
        self.forged_seqs = []

    def record(self, seq: int, status: str) -> Optional[Decision]:
        """Feed one transmission result; returns a Decision if an action is needed (already applied)."""
        self.history.append((seq, status))
        del self.history[:-max(self.cfg.window, self.cfg.clean_run)]
        if status == HMAC_FAIL and seq not in self.forged_seqs:
            self.forged_seqs.append(seq)
        d = decide(self.history, self.settings, self.cfg, self.compromised)
        if d is None:
            return None
        self.settings = d.settings
        if d.action == "intrusion_alert":
            self.compromised = True
        elif d.action in ("fec_on", "halve_chunk", "fec_off"):
            self.history.clear()          # judge the NEW settings on fresh evidence
        return d
