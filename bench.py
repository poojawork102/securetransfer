"""
Performance experiments -> results/*.csv, results/*.png, results/report.md

    python bench.py            (self-contained: starts its own server + proxy on free ports)

Experiments
  1. Error rate sweep  : CRC+retransmit (ARQ)  vs  Hamming FEC  — throughput, retransmits, overhead
  2. Latency sweep     : added channel delay -> RTT, jitter, throughput
  3. Chunk size sweep  : throughput vs chunk size on a 2 ms link
  4. Attack            : forged chunks accepted with CRC only vs HMAC
"""
import csv
import os
import random
import statistics
import tempfile
import time

import config
import telemetry
from client import send_file
from proxy import Proxy
from server import FileServer

telemetry.disable()
OUT = config.RESULTS_DIR
os.makedirs(OUT, exist_ok=True)
REPEATS = 3
LINK_MS = 2.0  # emulated one-way delay so retransmissions actually cost something


def setup():
    tmp = tempfile.mkdtemp()
    srv = FileServer(port=0, out_dir=tmp, quiet=True).start(background=True)
    px = Proxy(0, server_port=srv.port, control_port=None, seed=2026, quiet=True).start(background=True)
    f = os.path.join(tmp, "bench_128k.bin")
    with open(f, "wb") as fh:
        fh.write(random.Random(1).randbytes(128 * 1024))
    time.sleep(0.1)
    return srv, px, f


def trial(px, f, repeats=REPEATS, chunk=1024, **proxy_state):
    hmac = proxy_state.pop("hmac", False)
    fec = proxy_state.pop("fec", False)
    px.set_state(**{"mode": "clean", "rate": 0, "bits": 1, "delay_ms": 0, "loss": 0, **proxy_state})
    runs = [send_file(f, "127.0.0.1", px.listen_port, chunk_size=chunk, use_hmac=hmac, use_fec=fec, quiet=True,
                      max_retries=30)
            for _ in range(repeats)]
    avg = lambda k: round(statistics.mean(r[k] for r in runs), 3)          # noqa: E731
    srv = lambda k: round(statistics.mean(r["server_stats"].get(k, 0) for r in runs), 2)  # noqa: E731
    return {"throughput_kbps": avg("throughput_kbps"), "elapsed_s": avg("elapsed_s"), "avg_rtt_ms": avg("avg_rtt_ms"),
            "jitter_ms": avg("jitter_ms"), "retransmits": avg("retransmits"), "overhead_pct": avg("overhead_pct"),
            "crc_fail": srv("crc_fail"), "hmac_fail": srv("hmac_fail"), "corrected": srv("corrected"),
            "verified_pct": round(100 * sum(r["verified"] for r in runs) / len(runs), 1)}


def save(name, rows):
    with open(os.path.join(OUT, name), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def md_table(rows, cols):
    head = "| " + " | ".join(cols) + " |\n|" + "---|" * len(cols) + "\n"
    return head + "".join("| " + " | ".join(str(r[c]) for c in cols) + " |\n" for r in rows)


def main():
    srv, px, f = setup()
    print("running experiments (≈1 min)…")

    # 1. error-rate sweep
    noise = []
    for rate in (0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5):
        for scheme, fec in (("CRC+ARQ", False), ("Hamming FEC", True)):
            r = trial(px, f, mode="noise", rate=rate, bits=1, delay_ms=LINK_MS, fec=fec)
            noise.append({"error_rate_pct": int(rate * 100), "scheme": scheme, **r})
            print(f"  noise {rate:>4.0%} {scheme:<12} {r['throughput_kbps']:>8} KB/s  rtx={r['retransmits']}")
    save("bench_noise.csv", noise)

    # 2. latency sweep
    lat = []
    for d in (0, 1, 2, 5, 10, 20):
        r = trial(px, f, delay_ms=d)
        lat.append({"added_latency_ms": d, **r})
        print(f"  latency {d:>3} ms  rtt={r['avg_rtt_ms']} ms  {r['throughput_kbps']} KB/s")
    save("bench_latency.csv", lat)

    # 3. chunk-size sweep
    chunks = []
    for c in (256, 512, 1024, 2048, 4096, 8192):
        r = trial(px, f, chunk=c, delay_ms=LINK_MS)
        chunks.append({"chunk_size_B": c, **r})
        print(f"  chunk {c:>5} B  {r['throughput_kbps']} KB/s  overhead {r['overhead_pct']}%")
    save("bench_chunk.csv", chunks)

    # 4. attack
    attack = []
    for hmac in (False, True):
        r = trial(px, f, mode="attack", rate=0.2, hmac=hmac)
        attack.append({"protection": "CRC32 + HMAC-SHA256" if hmac else "CRC32 only", **r})
        print(f"  attack hmac={hmac}  verified={r['verified_pct']}%  hmac_fail={r['hmac_fail']}")
    save("bench_attack.csv", attack)

    px.stop()
    srv.stop()
    plots(noise, lat, chunks)
    report(noise, lat, chunks, attack)
    print(f"done -> {OUT}")


def plots(noise, lat, chunks):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed — skipping graphs")
        return
    plt.rcParams.update({"figure.dpi": 130, "axes.grid": True, "grid.alpha": .3, "axes.spines.top": False,
                         "axes.spines.right": False})
    colors = {"CRC+ARQ": "#0ea5b7", "Hamming FEC": "#7c3aed"}

    fig, ax = plt.subplots(1, 2, figsize=(11, 4))
    for scheme in colors:
        rows = [r for r in noise if r["scheme"] == scheme]
        x = [r["error_rate_pct"] for r in rows]
        ax[0].plot(x, [r["throughput_kbps"] for r in rows], "o-", color=colors[scheme], label=scheme)
        ax[1].plot(x, [r["retransmits"] for r in rows], "o-", color=colors[scheme], label=scheme)
    ax[0].set(title="Throughput vs channel error rate", xlabel="% chunks corrupted (1-bit)", ylabel="KB/s")
    ax[1].set(title="Retransmissions vs channel error rate", xlabel="% chunks corrupted (1-bit)", ylabel="retransmits / 128 KB")
    ax[0].legend()
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "noise_tradeoff.png"))

    fig, ax1 = plt.subplots(figsize=(6, 4))
    x = [r["added_latency_ms"] for r in lat]
    ax1.plot(x, [r["avg_rtt_ms"] for r in lat], "o-", color="#7c3aed", label="avg RTT")
    ax1.set(xlabel="added one-way latency (ms)", ylabel="RTT (ms)", title="Latency vs RTT & throughput")
    ax2 = ax1.twinx()
    ax2.plot(x, [r["throughput_kbps"] for r in lat], "s--", color="#0ea5b7", label="throughput")
    ax2.set_ylabel("KB/s")
    fig.legend(loc="upper center", ncol=2, bbox_to_anchor=(.5, .9))
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "latency.png"))

    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot([r["chunk_size_B"] for r in chunks], [r["throughput_kbps"] for r in chunks], "o-", color="#0ea5b7")
    ax.set_xscale("log", base=2)
    ax.set(xlabel="chunk size (bytes)", ylabel="KB/s", title=f"Throughput vs chunk size ({LINK_MS:.0f} ms link)")
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "chunk_size.png"))
    plt.close("all")


def report(noise, lat, chunks, attack):
    with open(os.path.join(OUT, "report.md"), "w") as fh:
        fh.write("# Performance results\n\n")
        fh.write(f"128 KB random file, averaged over {REPEATS} runs, emulated link delay {LINK_MS} ms "
                 "(unless stated). Generated by `bench.py`.\n\n")
        fh.write("## 1. Error control: CRC + retransmit vs Hamming FEC\n\n![](noise_tradeoff.png)\n\n")
        fh.write(md_table(noise, ["error_rate_pct", "scheme", "throughput_kbps", "retransmits", "corrected",
                                  "overhead_pct", "verified_pct"]))
        fh.write("\n## 2. Latency\n\n![](latency.png)\n\n")
        fh.write(md_table(lat, ["added_latency_ms", "avg_rtt_ms", "jitter_ms", "throughput_kbps", "elapsed_s"]))
        fh.write("\n## 3. Chunk size\n\n![](chunk_size.png)\n\n")
        fh.write(md_table(chunks, ["chunk_size_B", "throughput_kbps", "avg_rtt_ms", "overhead_pct"]))
        fh.write("\n## 4. Man-in-the-middle attack (20% of chunks forged, CRC recomputed)\n\n")
        fh.write(md_table(attack, ["protection", "verified_pct", "hmac_fail", "retransmits", "throughput_kbps"]))
        fh.write("\n`verified_pct` = runs where the received file's SHA-256 matched the original.\n")


if __name__ == "__main__":
    main()
