"""
SecureTransfer DASHBOARD: Flask + Socket.IO.

Listens for UDP telemetry from client/proxy/server and pushes it to the browser.
Lets you pick a file and options, and launch the client from the browser.
Changes the proxy channel mode live (UDP control message).
Keeps a session log and serves the Numerical Lab API.

Run:  python dashboard/app.py      then open http://localhost:5050
"""
import csv
import json
import os
import socket
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, Response, jsonify, request, send_from_directory  # noqa: E402
from flask_socketio import SocketIO                                      # noqa: E402

import client as st_client   # noqa: E402
import config                # noqa: E402
import numericals            # noqa: E402
from dashboard import mdlite # noqa: E402

BASE_DIR = config.BASE_DIR
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
RESULTS_DIR = os.path.join(BASE_DIR, "results")
DIST_DIR = os.path.join(BASE_DIR, "frontend", "dist")

os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")

_busy = threading.Lock()
_ctrl = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

LAST_SEEN = {"client": 0.0, "proxy": 0.0, "server": 0.0}
PROXY_STATE = {}
SESSION = []


def telemetry_listener():
    u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    u.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    u.bind(("0.0.0.0", config.TELEMETRY_PORT))
    print(f"[DASH  ] telemetry on UDP :{config.TELEMETRY_PORT}", flush=True)
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


# ------------------------------------------------------------ serve React build
@app.route("/")
def index():
    return send_from_directory(DIST_DIR, "index.html")


@app.route("/assets/<path:name>")
def assets(name):
    return send_from_directory(os.path.join(DIST_DIR, "assets"), name)


@app.route("/favicon.svg")
def favicon():
    return send_from_directory(os.path.join(DIST_DIR), "favicon.svg")


@app.route("/fonts/<path:name>")
def fonts(name):
    return send_from_directory(os.path.join(DIST_DIR, "fonts"), name)


# ------------------------------------------------------------ simple APIs
@app.get("/api/samples")
def samples():
    dirs = [config.SAMPLES_DIR]
    demo_dir = os.path.join(BASE_DIR, "demo_files")
    if os.path.isdir(demo_dir):
        dirs.append(demo_dir)
    files = []
    for d in dirs:
        for f in sorted(os.listdir(d)):
            if f.startswith("."):
                continue
            files.append({"name": f, "size": os.path.getsize(os.path.join(d, f)), "dir": os.path.basename(d)})
    return jsonify(files)


@app.get("/api/health")
def health():
    now = time.time()
    return jsonify(server=now - LAST_SEEN["server"] < 4, proxy=now - LAST_SEEN["proxy"] < 4,
                   proxy_state=PROXY_STATE, busy=_busy.locked(),
                   ports={"server": config.SERVER_PORT, "proxy": config.PROXY_PORT})


@app.post("/api/proxy")
def set_proxy():
    _ctrl.sendto(json.dumps(request.get_json(force=True)).encode(), ("127.0.0.1", config.PROXY_CONTROL_PORT))
    return jsonify(ok=True)


# ------------------------------------------------------------ sending
def protection_text(stats):
    parts = ["Checksum16" if stats.get("check") == "checksum16" else "CRC32"]
    if stats.get("fec"):
        parts.append("Hamming")
    return " + ".join(parts)


def record_session(opts, path, stats=None, error=None):
    stats = stats or (error.stats if error else {}) or {}
    ss = stats.get("server_stats", {})
    if error:
        verdict = "Failed: " + str(error)
    elif stats.get("verified"):
        verdict = "Verified"
    else:
        verdict = "Rejected"
    SESSION.append({
        "n": len(SESSION) + 1, "time": time.strftime("%H:%M:%S"),
        "file": os.path.basename(path), "protection": protection_text(stats) if stats else "-",
        "retransmits": stats.get("retransmits", 0), "bits_fixed": ss.get("bits_fixed", 0),
        "verdict": verdict, "ok": bool(stats.get("verified")) and not error,
    })


@app.post("/api/send")
def send():
    if not _busy.acquire(blocking=False):
        return jsonify(ok=False, error="a transfer is already running"), 409
    try:
        opts = json.loads(request.form.get("opts", "{}"))
        up = request.files.get("file")
        if up and up.filename:
            safe_name = os.path.basename(up.filename)
            path = os.path.join(UPLOAD_DIR, safe_name)
            up.save(path)
        else:
            sample = os.path.basename(opts.get("sample", "sample.txt"))
            path = os.path.join(config.SAMPLES_DIR, sample)
            if not os.path.isfile(path):
                demo_path = os.path.join(BASE_DIR, "demo_files", sample)
                if os.path.isfile(demo_path):
                    path = demo_path
        if not os.path.isfile(path):
            _busy.release()
            return jsonify(ok=False, error="file not found"), 400
    except Exception as e:  # noqa: BLE001
        _busy.release()
        return jsonify(ok=False, error=str(e)), 400

    def worker():
        try:
            stats = st_client.send_file(
                path, config.HOST, int(opts.get("port", config.PROXY_PORT)),
                chunk_size=int(opts.get("chunk", 1024)),
                use_fec=bool(opts.get("fec")),
                delay_ms=int(opts.get("delay", 0)),
                timeout=float(opts.get("timeout", 1.0)), quiet=False,
                check="checksum16" if opts.get("check") == "checksum16" else "crc32")
            record_session(opts, path, stats=stats)
        except st_client.TransferError as e:
            print(f"[DASH  ] transfer failed: {e}", flush=True)
            record_session(opts, path, error=e)
        finally:
            _busy.release()

    threading.Thread(target=worker, daemon=True).start()
    return jsonify(ok=True, file=os.path.basename(path))


# ------------------------------------------------------------ session + reports
@app.get("/api/session")
def session():
    return jsonify(SESSION)


@app.post("/api/session/clear")
def session_clear():
    SESSION.clear()
    return jsonify(ok=True)


def report_markdown():
    lines = [
        "# SecureTransfer session report", "",
        f"Generated {time.strftime('%Y-%m-%d %H:%M:%S')}.", "",
        "| # | Time | File | Protection | Retransmits | Bits fixed | Verdict |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in SESSION:
        lines.append(
            f"| {r['n']} | {r['time']} | {r['file']} | {r['protection']} "
            f"| {r['retransmits']} | {r['bits_fixed']} | {r['verdict']} |"
        )
    if not SESSION:
        lines.append("| - | - | no transfers yet | | | | |")
    return "\n".join(lines) + "\n"


@app.get("/api/report.md")
def report_md():
    return Response(report_markdown(), mimetype="text/markdown",
                    headers={"Content-Disposition": "attachment; filename=session_report.md"})


@app.get("/api/report.html")
def report_html():
    return Response(mdlite.render(report_markdown(), "Session report"), mimetype="text/html")


# ------------------------------------------------------------ results (bench.py CSVs)
@app.get("/api/results")
def results():
    out = {}
    for name in os.listdir(RESULTS_DIR):
        if not name.endswith(".csv"):
            continue
        path = os.path.join(RESULTS_DIR, name)
        try:
            with open(path, newline="", encoding="utf-8") as f:
                out[name] = list(csv.DictReader(f))
        except Exception:  # noqa: BLE001
            pass
    return jsonify(out)


# ------------------------------------------------------------ numerical solvers
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


def main():
    if not os.path.isdir(DIST_DIR):
        print("[DASH  ] WARNING: frontend/dist/ not found. Run: cd frontend && npm run build", flush=True)
    threading.Thread(target=telemetry_listener, daemon=True).start()
    print(f"[DASH  ] open http://localhost:{config.DASHBOARD_PORT}", flush=True)
    socketio.run(app, host="0.0.0.0", port=config.DASHBOARD_PORT, allow_unsafe_werkzeug=True)


if __name__ == "__main__":
    main()
