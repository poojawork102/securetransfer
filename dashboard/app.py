"""
SecureTransfer DASHBOARD — Flask + Socket.IO.

* Listens for UDP telemetry from client / proxy / server and pushes it live to the browser.
* Lets you pick a file + options and launch the client from the browser.
* Changes the proxy's channel mode live (UDP control message).

Run:  python dashboard/app.py      then open http://localhost:5050
"""
import json
import os
import socket
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, jsonify, render_template, request          # noqa: E402
from flask_socketio import SocketIO                                  # noqa: E402

import client as st_client                                           # noqa: E402
import config                                                        # noqa: E402

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")

UPLOAD_DIR = os.path.join(config.BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
_busy = threading.Lock()
_ctrl = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)


def telemetry_listener():
    u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    u.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    u.bind(("0.0.0.0", config.TELEMETRY_PORT))
    print(f"[DASH  ] telemetry listening on UDP :{config.TELEMETRY_PORT}", flush=True)
    while True:
        data, _ = u.recvfrom(65535)
        try:
            socketio.emit("telemetry", json.loads(data))
        except ValueError:
            pass


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/samples")
def samples():
    files = sorted(f for f in os.listdir(config.SAMPLES_DIR) if not f.startswith("."))
    return jsonify([{"name": f, "size": os.path.getsize(os.path.join(config.SAMPLES_DIR, f))} for f in files])


@app.post("/api/proxy")
def set_proxy():
    _ctrl.sendto(json.dumps(request.get_json(force=True)).encode(), ("127.0.0.1", config.PROXY_CONTROL_PORT))
    return jsonify(ok=True)


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
            st_client.send_file(path, config.HOST, int(opts.get("port", config.PROXY_PORT)),
                                chunk_size=int(opts.get("chunk", 1024)), use_hmac=bool(opts.get("hmac")),
                                use_fec=bool(opts.get("fec")), delay_ms=int(opts.get("delay", 40)),
                                timeout=float(opts.get("timeout", 1.0)))
        except st_client.TransferError as e:
            print(f"[DASH  ] transfer failed: {e}", flush=True)
        finally:
            _busy.release()

    threading.Thread(target=worker, daemon=True).start()
    return jsonify(ok=True, file=os.path.basename(path))


def main():
    threading.Thread(target=telemetry_listener, daemon=True).start()
    print(f"[DASH  ] open http://localhost:{config.DASHBOARD_PORT}", flush=True)
    socketio.run(app, host="0.0.0.0", port=config.DASHBOARD_PORT, allow_unsafe_werkzeug=True)


if __name__ == "__main__":
    main()
