import "./WiresharkTab.css";

const CAPTURES = [
  { id: "handshake", title: "TCP 3-way handshake", proves: "TCP connection establishment between client and server" },
  { id: "header", title: "Frame header bytes 46 54 02 02", proves: "Custom protocol magic bytes 'FT', version 2, DATA type" },
  { id: "sequence", title: "Sequence numbers incrementing", proves: "Stop-and-wait ARQ with ordered chunk delivery" },
  { id: "ack_nack", title: "ACK and NACK frames", proves: "Server acknowledges good chunks and rejects bad ones" },
  { id: "retransmit", title: "Retransmission after NACK", proves: "Client re-sends the chunk after receiving a NACK" },
  { id: "loss", title: "Frame loss and timeout recovery", proves: "Timeout triggers retransmission when a frame is dropped" },
];

export default function WiresharkTab() {
  return (
    <div className="wireshark-tab">
      <section className="card">
        <h3>How to capture</h3>
        <ol className="capture-steps">
          <li>Install <a href="https://npcap.com" target="_blank" rel="noopener">Npcap</a> (Windows) or use the built-in loopback adapter (Linux/macOS).</li>
          <li>Open Wireshark, select the <strong>Npcap Loopback Adapter</strong>.</li>
          <li>Set the display filter: <code>tcp.port == 8000 || tcp.port == 9000</code></li>
          <li>Run <code>python run_all.py</code> in a separate terminal.</li>
          <li>Run a transfer from the Demo tab (objective 1 or 2).</li>
          <li>Stop the capture. Save as <code>captures/clean.pcapng</code> or <code>captures/noise.pcapng</code>.</li>
        </ol>
      </section>

      <section className="card">
        <h3>Required captures</h3>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 16 }}>
          Save real .pcapng files to the captures/ directory. Screenshots go in docs/diagrams/.
        </p>
        <div className="capture-grid">
          {CAPTURES.map((cap) => (
            <div key={cap.id} className="capture-slot">
              <div className="capture-placeholder">
                <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
                  <rect x="4" y="8" width="40" height="32" rx="4" fill="none" stroke="var(--border)" strokeWidth="1.5" />
                  <line x1="4" y1="16" x2="44" y2="16" stroke="var(--border)" strokeWidth="1" />
                  <text x="24" y="30" textAnchor="middle" fill="var(--text-muted)" fontSize="8">capture</text>
                  <text x="24" y="38" textAnchor="middle" fill="var(--text-muted)" fontSize="8">pending</text>
                </svg>
              </div>
              <div className="capture-info">
                <strong>{cap.title}</strong>
                <span className="muted">{cap.proves}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
