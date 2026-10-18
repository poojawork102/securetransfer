export const OBJECTIVES = [
  {
    id: "O1",
    key: "1",
    label: "Does the file arrive intact?",
    detail: "TCP, chunks, SHA-256",
    config: { mode: "clean", rate: 0, check: "checksum16", fec: false, hmac: false },
    expected: "File verified by SHA-256",
  },
  {
    id: "O2",
    key: "2",
    label: "Does the checksum detect damaged chunks?",
    detail: "16-bit checksum, NACK, retransmit",
    config: { mode: "noise", rate: 0.3, check: "checksum16", fec: false, hmac: false },
    expected: "All damaged chunks detected and retransmitted",
  },
  {
    id: "O3",
    key: "3",
    label: "Can Hamming fix 1-bit errors without re-sending?",
    detail: "Hamming(7,4) forward error correction",
    config: { mode: "noise", rate: 0.3, check: "checksum16", fec: true, hmac: false },
    expected: "0 retransmissions, all errors corrected",
  },
  {
    id: "O4",
    key: "4",
    label: "Checksum vs CRC32: which detects more?",
    detail: "Word-swap case",
    config: { mode: "noise", rate: 0.3, pattern: "swap", check: "checksum16", fec: false, hmac: false },
    expected: "Checksum misses the swap, CRC32 catches it",
  },
];

export const COLORS = {
  travelling: "#ffffff",
  damaged: "#f59e0b",
  nacked: "#ef4444",
  corrected: "#3b82f6",
  accepted: "#22c55e",
};

export const STATUS_COLORS = {
  ok: "green",
  detected: "amber",
  corrected: "blue",
  failed: "red",
  forged: "purple",
};

export const TEAM = [
  { name: "Pooja Lingwat", prn: "1262242831", panel: "C" },
  { name: "Saloni Muley", prn: "", panel: "" },
  { name: "Aaditya Anekar", prn: "", panel: "" },
  { name: "Pratham Shelke", prn: "", panel: "" },
];
