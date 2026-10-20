"""Shared configuration. Override any value with an environment variable."""
import os
import sys

if os.name == "nt":
    os.system("")
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

HOST = os.environ.get("ST_HOST", "127.0.0.1")

SERVER_PORT = int(os.environ.get("ST_SERVER_PORT", 9000))
PROXY_PORT = int(os.environ.get("ST_PROXY_PORT", 8000))
PROXY_CONTROL_PORT = int(os.environ.get("ST_PROXY_CTRL", 5556))
TELEMETRY_PORT = int(os.environ.get("ST_TELEMETRY_PORT", 5555))
DASHBOARD_PORT = int(os.environ.get("ST_DASHBOARD_PORT", 5050))

SERVER_HOST = os.environ.get("ST_SERVER_HOST", HOST)
TELEMETRY_HOST = os.environ.get("ST_TELEMETRY_HOST", "127.0.0.1")

DEFAULT_CHUNK_SIZE = 1024
ACK_TIMEOUT_S = 5.0
MAX_RETRIES = 8

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RECEIVED_DIR = os.path.join(BASE_DIR, "received")
SAMPLES_DIR = os.path.join(BASE_DIR, "sample_files")
RESULTS_DIR = os.path.join(BASE_DIR, "results")
