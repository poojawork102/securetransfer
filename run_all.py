"""
One command to start everything: bench (if needed) + server + proxy + dashboard,
then open the browser.

    python run_all.py

Ctrl+C stops all three. (For the viva/demo you can also run each one in its own terminal —
see README.)
"""
import os
import subprocess
import sys
import time
import webbrowser

import config

HERE = os.path.dirname(os.path.abspath(__file__))
PROCS = [
    ("server", [sys.executable, "server.py"]),
    ("proxy", [sys.executable, "proxy.py"]),
    ("dashboard", [sys.executable, os.path.join("dashboard", "app.py")]),
]

EXPECTED_CSVS = [
    "bench_noise.csv", "bench_latency.csv", "bench_chunk.csv",
    "bench_detection.csv", "bench_loss.csv",
]


def run_bench_if_needed():
    results_dir = config.RESULTS_DIR
    missing = [f for f in EXPECTED_CSVS if not os.path.exists(os.path.join(results_dir, f))]
    if not missing:
        return
    print(f"  Generating benchmark data ({len(missing)} CSV files missing)...", flush=True)
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
    ret = subprocess.call([sys.executable, "bench.py"], cwd=HERE, env=env)
    if ret == 0:
        print("  Benchmarks complete.\n", flush=True)
    else:
        print("  bench.py finished with errors (charts may be incomplete).\n", flush=True)


def main():
    run_bench_if_needed()

    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
    procs = []
    try:
        for name, cmd in PROCS:
            procs.append(subprocess.Popen(cmd, cwd=HERE, env=env))
            time.sleep(0.6)
        url = f"http://localhost:{config.DASHBOARD_PORT}"
        print(f"\n  Dashboard: {url}\n  Ctrl+C to stop everything\n", flush=True)
        time.sleep(1.0)
        webbrowser.open(url)
        while all(p.poll() is None for p in procs):
            time.sleep(0.5)
        print("a component exited -- shutting down", flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()
        for p in procs:
            try:
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    main()
