"""Generate demo sample files for the SecureTransfer lab.

Run:  python tools/make_demo_files.py

Creates demo_files/ with a few small files suitable for live demo transfers.
"""
import os
import random
import string
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE_DIR, "demo_files")


def make_text(path, size_kb):
    rng = random.Random(42)
    words = ["the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog",
             "TCP", "checksum", "packet", "frame", "error", "retransmit",
             "server", "client", "proxy", "ACK", "NACK", "transfer"]
    lines = []
    while sum(len(l) + 1 for l in lines) < size_kb * 1024:
        line = " ".join(rng.choice(words) for _ in range(rng.randint(5, 15)))
        lines.append(line)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def make_binary(path, size_kb):
    rng = random.Random(7)
    with open(path, "wb") as f:
        f.write(rng.randbytes(size_kb * 1024))


def make_csv(path, rows):
    rng = random.Random(99)
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


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    make_text(os.path.join(OUT_DIR, "lorem_4kb.txt"), 4)
    make_text(os.path.join(OUT_DIR, "lorem_64kb.txt"), 64)
    make_binary(os.path.join(OUT_DIR, "random_128kb.bin"), 128)
    make_csv(os.path.join(OUT_DIR, "students_200.csv"), 200)
    print(f"Created demo files in {OUT_DIR}/")
    for f in sorted(os.listdir(OUT_DIR)):
        size = os.path.getsize(os.path.join(OUT_DIR, f))
        print(f"  {f:30s} {size:>8,d} bytes")


if __name__ == "__main__":
    main()
