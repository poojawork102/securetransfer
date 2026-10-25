import { useState, useEffect, useRef, useCallback } from "react";
import "./LiveTerminal.css";

const pad = (n, w = 4) => String(n).padStart(w, " ");

const HANDSHAKE = [
  { label: "CLIENT", text: "SYN             -> server", type: "syn" },
  { label: "SERVER", text: "SYN+ACK         -> client", type: "syn" },
  { label: "CLIENT", text: "ACK             -> server", type: "syn" },
  { label: "------", text: "connection established ------", type: "ok" },
];

const OBJ_HEADERS = {
  O1: "Objective 1: Clean transfer (no errors)",
  O2: "Objective 2: Noise + checksum detection",
  O3: "Objective 3: Hamming(7,4) FEC",
  O4: "Objective 4: Checksum vs CRC32",
};

export default function LiveTerminal({ socket, activeObj, running }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState([]);
  const [handshakeDone, setHandshakeDone] = useState(false);
  const bottomRef = useRef(null);
  const timers = useRef([]);
  const seqRetries = useRef({});

  const addLine = useCallback((label, text, type = "info") => {
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    setLines((prev) => [...prev.slice(-200), { label, text, type, ts }]);
  }, []);

  useEffect(() => {
    if (!running) return;

    setLines([]);
    setHandshakeDone(false);
    seqRetries.current = {};
    timers.current.forEach(clearTimeout);
    timers.current = [];

    const header = OBJ_HEADERS[activeObj] || "Custom run";
    addLine("", `=== ${header} ===`, "header");
    addLine("", "", "blank");

    HANDSHAKE.forEach((h, i) => {
      const t = setTimeout(() => {
        addLine(h.label, h.text, h.type);
        if (i === HANDSHAKE.length - 1) {
          setTimeout(() => {
            addLine("", "", "blank");
            addLine("CLIENT", "META  filename, size, sha256  -> server", "send");
            addLine("SERVER", "META  ACK                     -> ready", "ok");
            addLine("", "", "blank");
            setHandshakeDone(true);
          }, 200);
        }
      }, 250 + i * 300);
      timers.current.push(t);
    });

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [running, activeObj, addLine]);

  useEffect(() => {
    if (!handshakeDone) return;

    return socket.onTelemetry((ev) => {
      if (ev.src === "client" && ev.ev === "send") {
        if (ev.attempt > 1) {
          addLine("CLIENT", `DATA  seq=${pad(ev.seq)}  retransmit #${ev.attempt - 1}`, "retry");
        } else {
          addLine("CLIENT", `DATA  seq=${pad(ev.seq)}  len=${ev.wire_len || ev.length || 256}B`, "send");
        }
      } else if (ev.src === "proxy" && ev.ev === "corrupt") {
        const pattern = ev.pattern === "swap"
          ? `swapped words at byte ${ev.byte_a} and ${ev.byte_b}`
          : `flipped ${ev.bits || 1} bit(s)${ev.wire_byte !== undefined ? ` (byte ${ev.wire_byte}, bit ${ev.bit})` : ""}`;
        addLine("PROXY ", `chunk ${pad(ev.seq)}  ${pattern}`, "warn");
      } else if (ev.src === "server" && ev.ev === "chunk") {
        if (ev.status === "ok") {
          addLine("SERVER", `chunk ${pad(ev.seq)}  OK              -> ACK`, "ok");
        } else if (ev.status === "corrected") {
          const fix = ev.fixes?.[0];
          addLine("SERVER", `chunk ${pad(ev.seq)}  Hamming FIX  syndrome=${fix?.syndrome || "?"} bit=${fix?.wire_bit || "?"}`, "fix");
          addLine("SERVER", `chunk ${pad(ev.seq)}  OK (corrected)  -> ACK`, "ok");
        } else if (ev.status === "crc_fail" || ev.status === "checksum_fail") {
          const reason = ev.status === "crc_fail" ? "CRC_FAIL" : "CHECKSUM_FAIL";
          addLine("SERVER", `chunk ${pad(ev.seq)}  ${reason} -> NACK`, "nack");
        }
      } else if (ev.src === "client" && ev.ev === "timeout") {
        addLine("CLIENT", `chunk ${pad(ev.seq)}  TIMEOUT -- no ACK, retransmitting`, "nack");
      } else if (ev.src === "server" && ev.ev === "result") {
        addLine("", "", "blank");
        addLine("CLIENT", "DONE  all chunks sent       -> server", "send");
        addLine("SERVER", `SHA-256 expected: ${ev.expected ? ev.expected.slice(0, 20) + "..." : "?"}`, "info");
        addLine("SERVER", `SHA-256 received: ${ev.got ? ev.got.slice(0, 20) + "..." : "?"}`, "info");
        if (ev.match) {
          addLine("SERVER", "RESULT  SHA-256 MATCH        -> VERIFIED", "ok");
        } else {
          addLine("SERVER", "RESULT  SHA-256 MISMATCH     -> REJECTED", "nack");
        }
        addLine("", "", "blank");
        addLine("CLIENT", "FIN                         -> server", "syn");
        addLine("SERVER", "ACK + FIN                   -> client", "syn");
        addLine("CLIENT", "ACK                         -> closed", "syn");
        addLine("", `=== Transfer complete ===`, "header");
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
              <button className="terminal-clear" onClick={() => setLines([])} title="Clear">
                Clear
              </button>
              <button className="terminal-close" onClick={() => setOpen(false)} title="Close">
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
                {line.type === "blank" ? (
                  <span className="tline-blank-space" />
                ) : line.type === "header" ? (
                  <span className="tline-text">{line.text}</span>
                ) : (
                  <>
                    <span className="tline-ts">{line.ts}</span>
                    <span className={`tline-label tline-label-${line.label?.trim().toLowerCase() || "info"}`}>
                      [{line.label}]
                    </span>
                    <span className="tline-text">{line.text}</span>
                  </>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </>
  );
}
