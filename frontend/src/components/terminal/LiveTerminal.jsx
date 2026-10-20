import { useState, useEffect, useRef, useCallback } from "react";
import "./LiveTerminal.css";

const HANDSHAKE_LINES = [
  { text: "[tcp] client -> server   SYN        seq=0", type: "syn" },
  { text: "[tcp] server -> client   SYN+ACK    seq=0 ack=1", type: "syn" },
  { text: "[tcp] client -> server   ACK        seq=1 ack=1", type: "syn" },
  { text: "[tcp] --- connection established ---", type: "ok" },
];

const OBJ_HEADERS = {
  O1: "Objective 1: Clean transfer (no errors injected)",
  O2: "Objective 2: Noise + 16-bit checksum detection",
  O3: "Objective 3: Hamming(7,4) forward error correction",
  O4: "Objective 4: Checksum vs CRC32 comparison",
};

export default function LiveTerminal({ socket, activeObj, running }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState([]);
  const [handshakeDone, setHandshakeDone] = useState(false);
  const bottomRef = useRef(null);
  const handshakeTimers = useRef([]);

  const addLine = useCallback((text, type = "info") => {
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    setLines((prev) => [...prev.slice(-150), { text, type, ts }]);
  }, []);

  useEffect(() => {
    if (!running) return;

    setLines([]);
    setHandshakeDone(false);

    handshakeTimers.current.forEach(clearTimeout);
    handshakeTimers.current = [];

    const header = OBJ_HEADERS[activeObj] || "Custom run";
    addLine(`=== ${header} ===`, "header");
    addLine("", "blank");
    addLine("[init] Starting TCP connection to proxy:9000 ...", "info");

    HANDSHAKE_LINES.forEach((line, i) => {
      const timer = setTimeout(() => {
        addLine(line.text, line.type);
        if (i === HANDSHAKE_LINES.length - 1) {
          setTimeout(() => {
            addLine("", "blank");
            addLine("[meta] Sending META frame: filename, size, SHA-256 hash", "info");
            addLine("[meta] Server ACKs META -- ready to receive chunks", "ok");
            addLine("", "blank");
            setHandshakeDone(true);
          }, 200);
        }
      }, 300 + i * 350);
      handshakeTimers.current.push(timer);
    });

    return () => {
      handshakeTimers.current.forEach(clearTimeout);
      handshakeTimers.current = [];
    };
  }, [running, activeObj, addLine]);

  useEffect(() => {
    if (!handshakeDone) return;

    return socket.onTelemetry((ev) => {
      if (ev.ev === "chunk_sent") {
        const check = activeObj === "O3" ? "checksum16+FEC" : ev.check || "checksum16";
        addLine(
          `[send] DATA  seq=${ev.seq}  len=${ev.len || "1024"}B  check=${check}`,
          "send"
        );
      } else if (ev.ev === "corrupt") {
        const pattern = ev.pattern || "bit-flip";
        addLine(
          `[proxy] Chunk ${ev.seq} damaged (${pattern})  bits_flipped=${ev.bits || "?"}`,
          "warn"
        );
      } else if (ev.ev === "chunk_ok") {
        addLine(
          `[recv] ACK   seq=${ev.seq}  checksum=OK`,
          "ok"
        );
      } else if (ev.ev === "chunk_nack") {
        const reason = ev.reason || "checksum_fail";
        addLine(
          `[recv] NACK  seq=${ev.seq}  reason=${reason}`,
          "nack"
        );
        addLine(
          `[send] RETRY seq=${ev.seq}  (retransmitting...)`,
          "retry"
        );
      } else if (ev.ev === "chunk_fixed") {
        addLine(
          `[fec]  Hamming corrected seq=${ev.seq}  syndrome=${ev.syndrome || "?"}  pos=${ev.pos || "?"}`,
          "fix"
        );
        addLine(
          `[recv] ACK   seq=${ev.seq}  (corrected, no retransmit)`,
          "ok"
        );
      } else if (ev.ev === "timeout") {
        addLine(
          `[send] TIMEOUT seq=${ev.seq}  (no ACK received, retransmitting)`,
          "nack"
        );
      } else if (ev.ev === "result") {
        addLine("", "blank");
        addLine("[done] DONE frame sent -- all chunks transferred", "info");
        addLine(
          `[sha]  Expected: ${ev.expected ? ev.expected.slice(0, 24) + "..." : "?"}`,
          "info"
        );
        addLine(
          `[sha]  Received: ${ev.got ? ev.got.slice(0, 24) + "..." : "?"}`,
          "info"
        );
        if (ev.match) {
          addLine("[sha]  SHA-256 MATCH -- file verified", "ok");
        } else {
          addLine("[sha]  SHA-256 MISMATCH -- file rejected", "nack");
        }
        addLine("", "blank");
        addLine("[tcp] FIN -> ACK -> FIN -> ACK  (connection closed)", "syn");
        addLine("=== Transfer complete ===", "header");
      }
    });
  }, [socket, handshakeDone, activeObj, addLine]);

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, open]);

  return (
    <>
      <button
        className={`terminal-toggle ${open ? "active" : ""} ${running ? "pulse" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle protocol log"
        title="Protocol log"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <polyline points="5,10 7,8 9,10" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="11" y1="10" x2="15" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="terminal-panel">
          <div className="terminal-header">
            <span className="terminal-title">Protocol Log</span>
            <div className="terminal-actions">
              <button
                className="terminal-clear"
                onClick={() => setLines([])}
                title="Clear"
              >
                Clear
              </button>
              <button
                className="terminal-close"
                onClick={() => setOpen(false)}
                title="Close"
              >
                x
              </button>
            </div>
          </div>
          <div className="terminal-body">
            {lines.length === 0 && (
              <p className="terminal-empty">Run an objective to see protocol logs here.</p>
            )}
            {lines.map((line, i) => (
              <div key={i} className={`tline tline-${line.type}`}>
                {line.type !== "blank" && line.type !== "header" && (
                  <span className="tline-ts">{line.ts}</span>
                )}
                <span className="tline-text">{line.text}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </>
  );
}
