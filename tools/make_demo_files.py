"""Generate demo sample files for the SecureTransfer lab.

Run:  python tools/make_demo_files.py

Creates demo_files/ with varied files suitable for live demo transfers,
plus demo_files/objectives/manifest.json with expected outcomes per objective.
"""
import json
import os
import random
import struct
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE_DIR, "demo_files")
OBJ_DIR = os.path.join(OUT_DIR, "objectives")


def make_text(path, size_kb, seed=42):
    rng = random.Random(seed)
    words = [
        "the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog",
        "TCP", "checksum", "packet", "frame", "error", "retransmit",
        "server", "client", "proxy", "ACK", "NACK", "transfer",
        "protocol", "socket", "byte", "header", "payload", "segment",
        "network", "reliable", "data", "integrity", "hash", "verify",
    ]
    lines = []
    while sum(len(l) + 1 for l in lines) < size_kb * 1024:
        line = " ".join(rng.choice(words) for _ in range(rng.randint(5, 15)))
        lines.append(line)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def make_binary(path, size_kb, seed=7):
    rng = random.Random(seed)
    with open(path, "wb") as f:
        f.write(rng.randbytes(size_kb * 1024))


def make_csv(path, rows, seed=99):
    rng = random.Random(seed)
    header = "id,name,score,grade\n"
    names = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi"]
    grades = ["A", "B", "C", "D"]
    with open(path, "w", encoding="utf-8") as f:
        f.write(header)
        for i in range(1, rows + 1):
            name = rng.choice(names)
            score = rng.randint(40, 100)
            grade = rng.choice(grades)
            f.write(f"{i},{name},{score},{grade}\n")


def make_json_log(path, entries, seed=123):
    rng = random.Random(seed)
    events = ["login", "logout", "upload", "download", "error", "timeout"]
    users = ["admin", "student01", "student02", "guest"]
    records = []
    ts = 1700000000
    for _ in range(entries):
        ts += rng.randint(1, 300)
        records.append({
            "ts": ts,
            "user": rng.choice(users),
            "event": rng.choice(events),
            "status": rng.choice(["ok", "fail"]),
            "bytes": rng.randint(0, 65535),
        })
    with open(path, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2)
        f.write("\n")


def make_repeating(path, size_kb, seed=55):
    rng = random.Random(seed)
    pattern = rng.randbytes(64)
    with open(path, "wb") as f:
        written = 0
        target = size_kb * 1024
        while written < target:
            chunk = pattern * min(16, (target - written) // 64 or 1)
            f.write(chunk[:target - written])
            written += len(chunk[:target - written])


def make_manifest():
    manifest = {
        "description": "Expected outcomes for each demo objective. The frontend compares actual transfer results against these to show PASS/FAIL.",
        "objectives": {
            "O1": {
                "label": "Does the file arrive intact?",
                "expected": {
                    "sha256_match": True,
                    "retransmissions": 0,
                    "bits_corrected": 0,
                    "verdict": "VERIFIED",
                },
                "pass_criteria": "SHA-256 hashes match and zero retransmissions",
            },
            "O2": {
                "label": "Does the checksum detect damaged chunks?",
                "expected": {
                    "sha256_match": True,
                    "retransmissions_gt": 0,
                    "detection_rate_pct_gte": 90,
                    "verdict": "VERIFIED",
                },
                "pass_criteria": "All corrupted chunks detected (retransmissions > 0) and final file verified",
            },
            "O3": {
                "label": "Can Hamming fix 1-bit errors without re-sending?",
                "expected": {
                    "sha256_match": True,
                    "retransmissions": 0,
                    "bits_corrected_gt": 0,
                    "verdict": "VERIFIED",
                },
                "pass_criteria": "Zero retransmissions, bits corrected > 0, and file verified",
            },
            "O4": {
                "label": "Checksum vs CRC32: which detects more?",
                "expected": {
                    "checksum_run": {
                        "undetected_corruptions_gt": 0,
                    },
                    "crc_run": {
                        "detection_rate_pct_gte": 99,
                    },
                },
                "pass_criteria": "Checksum misses at least one word-swap corruption; CRC32 detects all or nearly all",
            },
        },
    }
    os.makedirs(OBJ_DIR, exist_ok=True)
    with open(os.path.join(OBJ_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    make_text(os.path.join(OUT_DIR, "sample.txt"), 4)
    make_text(os.path.join(OUT_DIR, "lorem_64kb.txt"), 64, seed=43)
    make_csv(os.path.join(OUT_DIR, "students_200.csv"), 200)
    make_json_log(os.path.join(OUT_DIR, "event_log.json"), 150)
    make_binary(os.path.join(OUT_DIR, "random_128kb.bin"), 128)
    make_repeating(os.path.join(OUT_DIR, "pattern_8kb.bin"), 8)

    make_manifest()

    print(f"Created demo files in {OUT_DIR}/")
    for root, dirs, files in os.walk(OUT_DIR):
        for f in sorted(files):
            fp = os.path.join(root, f)
            rel = os.path.relpath(fp, OUT_DIR)
            size = os.path.getsize(fp)
            print(f"  {rel:40s} {size:>8,d} bytes")


if __name__ == "__main__":
    main()
