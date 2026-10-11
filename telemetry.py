"""Fire-and-forget UDP telemetry so the dashboard can visualise what client/proxy/server are doing.
If the dashboard isn't running, events are silently dropped — the transfer never depends on it."""
import json
import socket
import time

import config

_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
_enabled = True


def disable():
    global _enabled
    _enabled = False


def emit(source: str, event: str, **data):
    if not _enabled:
        return
    msg = {"src": source, "ev": event, "t": time.time(), **data}
    try:
        _sock.sendto(json.dumps(msg).encode(), (config.TELEMETRY_HOST, config.TELEMETRY_PORT))
    except OSError:
        pass
