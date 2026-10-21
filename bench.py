"""
Performance experiments -> results/*.csv, results/*.png, results/report.md

    python bench.py            (self-contained: starts its own server + proxy on free ports)

Experiments
  1. Error rate sweep  : Checksum+ARQ  vs  Hamming FEC  -- throughput, retransmits, overhead
  2. Latency sweep     : added channel delay -> RTT, jitter, throughput
  3. Chunk size sweep  : throughput vs chunk size on a 2 ms link
  4. Detection         : 16-bit Internet checksum vs CRC32 under 1/2/3-bit errors, bursts and word swaps
  5. Frame loss        : dropped frames recovered by timeout + retransmit (throughput, timeouts, accuracy)
"""
import csv
import os
import random
import statistics
import tempfile
import time

import config
import protocol as P
import telemetry
from client import send_file
from proxy import Proxy, swap_words
from server import FileServer

telemetry.disable()
OUT = config.RESULTS_DIR
os.makedirs(OUT, exist_ok=True)
REPEATS = 3
LINK_MS = 2.0


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
    fec = proxy_state.pop("fec", False)
    check = proxy_state.pop("check", "checksum16")
    timeout = proxy_state.pop("timeout", config.ACK_TIMEOUT_S)
    runs = []
    for _ in range(repeats):
        px.set_state(**{"mode": "clean", "rate": 0, "bits": 1, "delay_ms": 0, "loss": 0, **proxy_state})
        runs.append(send_file(f, "127.0.0.1", px.listen_port, chunk_size=chunk, use_fec=fec,
                              quiet=True, max_retries=30, timeout=timeout, check=check))
    avg = lambda k: round(statistics.mean(r[k] for r in runs), 3)          # noqa: E731
    srv = lambda k: round(statistics.mean(r["server_stats"].get(k, 0) for r in runs), 2)  # noqa: E731
    overhead = round(statistics.mean(
        100 * (r["bytes_on_wire"] - r["size"]) / max(r["size"], 1) for r in runs
    ), 2)
    return {"throughput_kbps": avg("throughput_kbps"), "elapsed_s": avg("elapsed_s"), "avg_rtt_ms": avg("avg_rtt_ms"),
            "retransmits": avg("retransmits"), "overhead_pct": overhead,
            "crc_fail": srv("crc_fail"), "checksum_fail": srv("checksum_fail"),
            "corrected": srv("corrected"), "timeouts": avg("timeouts"),
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
    print("running experiments...")

    # 1. error-rate sweep
    noise = []
    for rate in (0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5):
        for scheme, fec in (("Checksum + ARQ", False), ("Hamming FEC", True)):
            r = trial(px, f, mode="noise", rate=rate, bits=1, delay_ms=LINK_MS, fec=fec)
            noise.append({"error_rate_pct": int(rate * 100), "scheme": scheme, **r})
            print(f"  noise {rate:>4.0%} {scheme:<16} {r['throughput_kbps']:>8} KB/s  rtx={r['retransmits']}")
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

    # 4. detection power of checksum16 vs CRC32
    detection = detection_experiment()
    save("bench_detection.csv", detection)
    for r in detection:
        print(f"  detection {r['error_pattern']:<26} checksum16 {r['checksum16_pct']:>7}%   crc32 {r['crc32_pct']:>7}%")

    # 5. frame loss
    loss_rows = []
    for loss in (0, 0.01, 0.02, 0.05, 0.10):
        r = trial(px, f, loss=loss, delay_ms=LINK_MS, timeout=0.25)
        loss_rows.append({"frame_loss_pct": int(loss * 100), **r})
        print(f"  loss {loss:>4.0%}  {r['throughput_kbps']:>8} KB/s  timeouts={r['timeouts']}  verified={r['verified_pct']}%")
    save("bench_loss.csv", loss_rows)

    px.stop()
    srv.stop()
    plots(noise, lat, chunks, detection, loss_rows)
    report(noise, lat, chunks, detection, loss_rows)
    print(f"done -> {OUT}")


def detection_experiment(trials=20000, size=1024, seed=7):
    rng = random.Random(seed)
    nbits = size * 8

    def flip(data, positions):
        buf = bytearray(data)
        for pos in positions:
            buf[pos // 8] ^= 1 << (pos % 8)
        return bytes(buf)

    def burst(data):
        length = rng.randint(2, 32)
        start = rng.randrange(nbits - length)
        inner = [start + i for i in range(1, length - 1) if rng.random() < 0.5]
        return flip(data, [start, start + length - 1] + inner)

    patterns = {
        "1-bit error": lambda d: flip(d, rng.sample(range(nbits), 1)),
        "2-bit error": lambda d: flip(d, rng.sample(range(nbits), 2)),
        "3-bit error": lambda d: flip(d, rng.sample(range(nbits), 3)),
        "burst (2-32 bits)": burst,
        "two 16-bit words swapped": lambda d: swap_words(d, rng)[0],
    }
    rows = []
    for name, damage in patterns.items():
        seen_csum = seen_crc = counted = 0
        for _ in range(trials):
            data = rng.randbytes(size)
            bad = damage(data)
            if bad == data:
                continue
            counted += 1
            seen_csum += P.internet_checksum16(bad) != P.internet_checksum16(data)
            seen_crc += P.crc32(bad) != P.crc32(data)
        rows.append({"error_pattern": name, "trials": counted,
                     "checksum16_pct": round(100 * seen_csum / counted, 3),
                     "crc32_pct": round(100 * seen_crc / counted, 3)})
    return rows


def plots(noise, lat, chunks, detection=None, loss_rows=None):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed -- skipping graphs")
        return
    plt.rcParams.update({"figure.dpi": 130, "axes.grid": True, "grid.alpha": .3, "axes.spines.top": False,
                         "axes.spines.right": False})
    colors = {"Checksum + ARQ": "#0ea5b7", "Hamming FEC": "#7c3aed"}

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

    if detection:
        fig, ax = plt.subplots(figsize=(9, 4))
        names = [r["error_pattern"] for r in detection]
        xs = range(len(names))
        b1 = ax.bar([i - 0.2 for i in xs], [r["checksum16_pct"] for r in detection], 0.4, color="#f59e0b", label="16-bit checksum")
        b2 = ax.bar([i + 0.2 for i in xs], [r["crc32_pct"] for r in detection], 0.4, color="#0ea5b7", label="CRC32")
        ax.bar_label(b1, fmt="%.1f%%", padding=2, fontsize=8)
        ax.bar_label(b2, fmt="%.1f%%", padding=2, fontsize=8)
        ax.set_xticks(list(xs), names, rotation=15)
        ax.set(ylabel="% of damaged chunks detected", ylim=(0, 115), title="Error detection: checksum16 vs CRC32 (1 KB chunks)")
        ax.legend(loc="upper center", ncol=2)
        fig.tight_layout()
        fig.savefig(os.path.join(OUT, "detection.png"))

    if loss_rows:
        fig, ax1 = plt.subplots(figsize=(6, 4))
        x = [r["frame_loss_pct"] for r in loss_rows]
        ax1.plot(x, [r["throughput_kbps"] for r in loss_rows], "o-", color="#0ea5b7", label="throughput")
        ax1.set(xlabel="% of DATA frames dropped", ylabel="KB/s", title="Frame loss: timeout + retransmit (0.25 s timeout)")
        ax2 = ax1.twinx()
        ax2.plot(x, [r["timeouts"] for r in loss_rows], "s--", color="#f59e0b", label="timeouts")
        ax2.set_ylabel("timeouts per 128 KB")
        fig.legend(loc="upper right", bbox_to_anchor=(.88, .88))
        fig.tight_layout()
        fig.savefig(os.path.join(OUT, "loss.png"))
    plt.close("all")


def report(noise, lat, chunks, detection=None, loss_rows=None):
    with open(os.path.join(OUT, "report.md"), "w") as fh:
        fh.write("# Performance results\n\n")
        fh.write(f"128 KB random file, averaged over {REPEATS} runs, emulated link delay {LINK_MS} ms "
                 "(unless stated). Generated by `bench.py`.\n\n")
        fh.write("## 1. Error control: Checksum + retransmit vs Hamming FEC\n\n![](noise_tradeoff.png)\n\n")
        fh.write(md_table(noise, ["error_rate_pct", "scheme", "throughput_kbps", "retransmits", "corrected",
                                  "overhead_pct", "verified_pct"]))
        fh.write("\n## 2. Latency\n\n![](latency.png)\n\n")
        fh.write(md_table(lat, ["added_latency_ms", "avg_rtt_ms", "throughput_kbps", "elapsed_s"]))
        fh.write("\n## 3. Chunk size\n\n![](chunk_size.png)\n\n")
        fh.write(md_table(chunks, ["chunk_size_B", "throughput_kbps", "avg_rtt_ms", "overhead_pct"]))
        if detection:
            fh.write("\n## 4. Error-detection power: 16-bit checksum vs CRC32\n\n![](detection.png)\n\n")
            fh.write(f"Up to {detection[0]['trials']} random 1 KB chunks per pattern (seeded), damage applied, "
                     "detection = the check value changed.\n\n")
            fh.write(md_table(detection, ["error_pattern", "trials", "checksum16_pct", "crc32_pct"]))
        if loss_rows:
            fh.write("\n## 5. Frame loss\n\n![](loss.png)\n\n")
            fh.write("The proxy silently drops a fraction of DATA frames; the client's ACK timeout fires and "
                     "the chunk is re-sent. Every run still ends verified.\n\n")
            fh.write(md_table(loss_rows, ["frame_loss_pct", "throughput_kbps", "timeouts", "retransmits", "elapsed_s",
                                          "verified_pct"]))


if __name__ == "__main__":
    main()
