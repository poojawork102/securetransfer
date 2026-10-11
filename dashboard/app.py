"""
SecureTransfer DASHBOARD — Flask + Socket.IO.

* Listens for UDP telemetry from client / proxy / server and pushes it live to the browser.
* Lets you pick a file + options and launch the client from the browser.
* Changes the proxy's channel mode live (UDP control message).
* Keeps a session log (for the downloadable report), serves the Numerical Lab API and the docs.

Run:  python dashboard/app.py      then open http://localhost:5050
"""
import json
import os
import socket
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, Response, abort, jsonify, render_template, request   # noqa: E402
from flask_socketio import SocketIO                                           # noqa: E402

import client as st_client                                                    # noqa: E402
import config                                                                 # noqa: E402
import numericals                                                             # noqa: E402
from dashboard import mdlite                                                  # noqa: E402

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")

UPLOAD_DIR = os.path.join(config.BASE_DIR, "uploads")
DOCS_DIR = os.path.join(config.BASE_DIR, "docs")
os.makedirs(UPLOAD_DIR, exist_ok=True)
_busy = threading.Lock()
_ctrl = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

LAST_SEEN = {"client": 0.0, "proxy": 0.0, "server": 0.0}     # when each component last sent telemetry
PROXY_STATE = {}                                             # latest channel settings reported by the proxy
SESSION = []                                                 # one row per finished transfer (for the report)
LAST_RUN = {}                                                # original + quarantined paths of the latest transfer


def telemetry_listener():
    u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    u.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    u.bind(("0.0.0.0", config.TELEMETRY_PORT))
    print(f"[DASH  ] telemetry listening on UDP :{config.TELEMETRY_PORT}", flush=True)
    while True:
        data, _ = u.recvfrom(65535)
        try:
            ev = json.loads(data)
        except ValueError:
            continue
        if ev.get("src") in LAST_SEEN:
            LAST_SEEN[ev["src"]] = time.time()
        if ev.get("src") == "proxy" and ev.get("ev") in ("heartbeat", "mode"):
            PROXY_STATE.update({k: ev[k] for k in ("mode", "rate", "bits", "delay_ms", "loss", "pattern") if k in ev})
        socketio.emit("telemetry", ev)


# ---------------------------------------------------------------------------- pages & simple APIs
@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/samples")
def samples():
    files = sorted(f for f in os.listdir(config.SAMPLES_DIR) if not f.startswith("."))
    return jsonify([{"name": f, "size": os.path.getsize(os.path.join(config.SAMPLES_DIR, f))} for f in files])


@app.get("/api/health")
def health():
    now = time.time()
    return jsonify(server=now - LAST_SEEN["server"] < 4, proxy=now - LAST_SEEN["proxy"] < 4,
                   proxy_state=PROXY_STATE, busy=_busy.locked(), ports={"server": config.SERVER_PORT,
                                                                         "proxy": config.PROXY_PORT})


@app.post("/api/proxy")
def set_proxy():
    _ctrl.sendto(json.dumps(request.get_json(force=True)).encode(), ("127.0.0.1", config.PROXY_CONTROL_PORT))
    return jsonify(ok=True)


# ---------------------------------------------------------------------------- sending
def protection_text(stats):
    fp = stats.get("final_protection", {})
    parts = ["Checksum16" if fp.get("check") == "checksum16" else "CRC32"]
    if fp.get("fec"):
        parts.append("Hamming")
    if fp.get("hmac"):
        parts.append("HMAC")
    return " + ".join(parts) + (" (auto)" if stats.get("auto") else "")


def record_session(opts, path, stats=None, error=None):
    """Append one row to the session table used by 'Results so far' and the downloadable report."""
    stats = stats or (error.stats if error else {}) or {}
    attempts = stats.get("attempts", [])
    ss = lambda k: sum(a.get("server_stats", {}).get(k, 0) for a in attempts)        # noqa: E731
    if error:
        verdict = "Failed: " + str(error)
    elif stats.get("verified") and len(attempts) > 1:
        verdict = "Verified after automatic recovery (quarantine + resend with HMAC)"
    elif stats.get("verified"):
        verdict = "Verified"
    else:
        verdict = "Rejected and quarantined"
    SESSION.append({"n": len(SESSION) + 1, "time": time.strftime("%H:%M:%S"), "scenario": opts.get("scenario") or "—",
                    "file": os.path.basename(path), "protection": protection_text(stats) if stats else "—",
                    "retransmits": stats.get("retransmits", 0), "bits_fixed": ss("bits_fixed"),
                    "forged_blocked": ss("hmac_fail"), "attempts": max(1, len(attempts)),
                    "decisions": len(stats.get("decisions", [])), "verdict": verdict,
                    "ok": bool(stats.get("verified")) and not error})
    LAST_RUN.clear()
    LAST_RUN.update({"orig": path, "quarantine": stats.get("quarantine_path")})


@app.post("/api/send")
def send():
    if not _busy.acquire(blocking=False):
        return jsonify(ok=False, error="a transfer is already running"), 409
    try:
        opts = json.loads(request.form.get("opts", "{}"))
        up = request.files.get("file")
        if up and up.filename:
            path = os.path.join(UPLOAD_DIR, os.path.basename(up.filename))
            up.save(path)
        else:
            path = os.path.join(config.SAMPLES_DIR, os.path.basename(opts.get("sample", "sample.txt")))
        if not os.path.isfile(path):
            _busy.release()
            return jsonify(ok=False, error="file not found"), 400
    except Exception as e:          # noqa: BLE001
        _busy.release()
        return jsonify(ok=False, error=str(e)), 400

    def worker():
        try:
            stats = st_client.send_file(
                path, config.HOST, int(opts.get("port", config.PROXY_PORT)),
                chunk_size=int(opts.get("chunk", 1024)), use_hmac=bool(opts.get("hmac")),
                use_fec=bool(opts.get("fec")), delay_ms=int(opts.get("delay", 40)),
                timeout=float(opts.get("timeout", 1.0)), quiet=False,
                check="checksum16" if opts.get("check") == "checksum16" else "crc32", auto=bool(opts.get("auto")))
            record_session(opts, path, stats=stats)
        except st_client.TransferError as e:
            print(f"[DASH  ] transfer failed: {e}", flush=True)
            record_session(opts, path, error=e)
        finally:
            _busy.release()

    threading.Thread(target=worker, daemon=True).start()
    return jsonify(ok=True, file=os.path.basename(path))


# ---------------------------------------------------------------------------- proof, session, reports
def diff_regions(a: bytes, b: bytes, gap=4, ctx=12, limit=6):
    """Where do two byte strings differ? Returns (regions, total_differing_bytes)."""
    n = min(len(a), len(b))
    diffs = [i for i in range(n) if a[i] != b[i]]
    regions, start, prev = [], None, None
    for i in diffs:
        if start is None:
            start = prev = i
        elif i - prev <= gap:
            prev = i
        else:
            regions.append((start, prev))
            start = prev = i
    if start is not None:
        regions.append((start, prev))
    show = lambda bs: "".join(chr(c) if 32 <= c < 127 else "·" for c in bs)           # noqa: E731
    out = []
    for s, e in regions[:limit]:
        lo, hi = max(0, s - ctx), min(n, e + 1 + ctx)
        out.append({"offset": s, "length": e - s + 1, "ctx_start": lo, "hit_start": s - lo, "hit_len": e - s + 1,
                    "orig_hex": a[lo:hi].hex(" "), "new_hex": b[lo:hi].hex(" "),
                    "orig_ascii": show(a[lo:hi]), "new_ascii": show(b[lo:hi])})
    return out, len(diffs), len(regions)


@app.get("/api/proof")
def proof():
    q, orig = LAST_RUN.get("quarantine"), LAST_RUN.get("orig")
    if not q or not orig or not os.path.isfile(q) or not os.path.isfile(orig):
        return jsonify(ok=False, error="no quarantined file from the latest transfer"), 404
    with open(orig, "rb") as fa, open(q, "rb") as fb:
        a, b = fa.read(), fb.read()
    regions, nbytes, nregions = diff_regions(a, b)
    return jsonify(ok=True, file=os.path.basename(orig), quarantine=os.path.basename(q), orig_size=len(a),
                   new_size=len(b), differing_bytes=nbytes, regions_total=nregions, regions=regions,
                   found_mark=b"HACKED!!" in b)


@app.get("/api/session")
def session():
    return jsonify(SESSION)


@app.post("/api/session/clear")
def session_clear():
    SESSION.clear()
    return jsonify(ok=True)


def report_markdown():
    lines = ["# SecureTransfer — test session report", "",
             f"Generated {time.strftime('%Y-%m-%d %H:%M:%S')} by the SecureTransfer dashboard.", "",
             "| # | Time | Scenario | File | Protection | Retransmits | Bits fixed | Forged blocked | Attempts | Verdict |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for r in SESSION:
        lines.append(f"| {r['n']} | {r['time']} | {r['scenario']} | {r['file']} | {r['protection']} | {r['retransmits']} "
                     f"| {r['bits_fixed']} | {r['forged_blocked']} | {r['attempts']} | {r['verdict']} |")
    if not SESSION:
        lines.append("| — | — | no transfers yet | | | | | | | |")
    lines += ["", "**Legend.** *Retransmits*: chunks sent again after a NACK/timeout. *Bits fixed*: single-bit errors "
              "repaired by Hamming without a resend. *Forged blocked*: chunks whose data was altered but whose CRC "
              "was recomputed by the attacker — rejected by HMAC. *Attempts* > 1 means the first copy failed the "
              "whole-file SHA-256 check, was quarantined, and the file was re-sent with HMAC."]
    return "\n".join(lines) + "\n"


@app.get("/api/report.md")
def report_md():
    return Response(report_markdown(), mimetype="text/markdown",
                    headers={"Content-Disposition": "attachment; filename=securetransfer_session_report.md"})


@app.get("/api/report.html")
def report_html():
    return Response(mdlite.render(report_markdown(), "SecureTransfer session report"), mimetype="text/html")


# ---------------------------------------------------------------------------- Numerical Lab + docs
@app.post("/api/numerical")
def numerical():
    body = request.get_json(force=True) or {}
    try:
        return jsonify(ok=True, solution=numericals.solve(body.pop("kind", ""), **body))
    except (ValueError, TypeError, KeyError) as e:
        return jsonify(ok=False, error=str(e)), 400


@app.get("/api/numerical/example")
def numerical_example():
    kind = request.args.get("kind", "checksum")
    try:
        return jsonify(ok=True, params=numericals.example(kind, request.args.get("which", "textbook"),
                                                         seed=request.args.get("seed", type=int)))
    except KeyError:
        return jsonify(ok=False, error="unknown solver"), 400


@app.post("/api/numerical/compare")
def numerical_compare():
    body = request.get_json(force=True) or {}
    try:
        return jsonify(ok=True, result=numericals.compare(body.get("input", ""), body.get("mode", "auto"),
                                                          body.get("scenario", "none"), body.get("flips", ()),
                                                          body.get("swap")))
    except (ValueError, TypeError) as e:
        return jsonify(ok=False, error=str(e)), 400


@app.get("/api/practice/new")
def practice_new():
    try:
        return jsonify(ok=True, question=numericals.practice_question(request.args.get("kind", "checksum"),
                                                                      request.args.get("seed", type=int)),
                       kinds=numericals.PRACTICE_KINDS)
    except ValueError as e:
        return jsonify(ok=False, error=str(e)), 400


@app.post("/api/practice/check")
def practice_check():
    body = request.get_json(force=True) or {}
    try:
        return jsonify(ok=True, **numericals.practice_check(body.get("question", {}), body.get("answer", "")))
    except (ValueError, TypeError, KeyError) as e:
        return jsonify(ok=False, error=str(e)), 400


@app.get("/docs/<path:name>")
def docs(name):
    rel = os.path.normpath(name)
    full = os.path.join(DOCS_DIR, rel)
    if rel.startswith("..") or not full.startswith(DOCS_DIR) or not full.endswith(".md") or not os.path.isfile(full):
        abort(404)
    with open(full, encoding="utf-8") as fh:
        return Response(mdlite.render(fh.read(), os.path.basename(name)), mimetype="text/html")


def main():
    threading.Thread(target=telemetry_listener, daemon=True).start()
    print(f"[DASH  ] open http://localhost:{config.DASHBOARD_PORT}", flush=True)
    socketio.run(app, host="0.0.0.0", port=config.DASHBOARD_PORT, allow_unsafe_werkzeug=True)


if __name__ == "__main__":
    main()
