import "./HowItWorksTab.css";

export default function HowItWorksTab() {
  return (
    <div className="howitworks">
      <section className="card">
        <h3>Architecture</h3>
        <div className="diagram-container">
          <svg viewBox="0 0 800 260" className="arch-svg" role="img" aria-label="System architecture: client sends frames to proxy on port 8000, proxy forwards to server on port 9000, dashboard observes via UDP telemetry on port 5555">
            {/* Client */}
            <rect x="20" y="60" width="140" height="80" rx="8" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
            <text x="90" y="95" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="600">Client</text>
            <text x="90" y="115" textAnchor="middle" fill="var(--text-muted)" fontSize="10">client.py</text>

            {/* Proxy */}
            <rect x="280" y="60" width="140" height="80" rx="8" fill="none" stroke="var(--amber)" strokeWidth="1.5" />
            <text x="350" y="95" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="600">Proxy (Channel)</text>
            <text x="350" y="115" textAnchor="middle" fill="var(--text-muted)" fontSize="10">proxy.py</text>

            {/* Server */}
            <rect x="540" y="60" width="140" height="80" rx="8" fill="none" stroke="var(--green)" strokeWidth="1.5" />
            <text x="610" y="95" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="600">Server</text>
            <text x="610" y="115" textAnchor="middle" fill="var(--text-muted)" fontSize="10">server.py</text>

            {/* Dashboard */}
            <rect x="280" y="180" width="140" height="60" rx="8" fill="none" stroke="var(--purple)" strokeWidth="1.5" />
            <text x="350" y="210" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="600">Dashboard</text>
            <text x="350" y="225" textAnchor="middle" fill="var(--text-muted)" fontSize="10">:5050</text>

            {/* Links */}
            <line x1="160" y1="90" x2="280" y2="90" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#arrow)" />
            <text x="220" y="83" textAnchor="middle" fill="var(--text-muted)" fontSize="9">TCP :8000</text>
            <line x1="280" y1="110" x2="160" y2="110" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="4 3" markerEnd="url(#arrow-muted)" />
            <text x="220" y="125" textAnchor="middle" fill="var(--text-muted)" fontSize="9">ACK / NACK</text>

            <line x1="420" y1="90" x2="540" y2="90" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#arrow)" />
            <text x="480" y="83" textAnchor="middle" fill="var(--text-muted)" fontSize="9">TCP :9000</text>
            <line x1="540" y1="110" x2="420" y2="110" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="4 3" markerEnd="url(#arrow-muted)" />
            <text x="480" y="125" textAnchor="middle" fill="var(--text-muted)" fontSize="9">ACK / NACK</text>

            {/* Telemetry lines */}
            <line x1="90" y1="140" x2="300" y2="180" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="350" y1="140" x2="350" y2="180" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="610" y1="140" x2="400" y2="180" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 3" />
            <text x="500" y="170" textAnchor="middle" fill="var(--text-muted)" fontSize="9">UDP :5555 telemetry</text>

            {/* Arrow markers */}
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <path d="M0,0 L8,3 L0,6" fill="none" stroke="var(--accent)" strokeWidth="1" />
              </marker>
              <marker id="arrow-muted" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <path d="M0,0 L8,3 L0,6" fill="none" stroke="var(--text-muted)" strokeWidth="1" />
              </marker>
            </defs>
          </svg>
        </div>
      </section>

      <section className="card">
        <h3>Frame format (17 bytes, big-endian)</h3>
        <div className="diagram-container">
          <svg viewBox="0 0 800 120" className="frame-svg" role="img" aria-label="Frame format: 2-byte magic FT, 1-byte version, 1-byte type, 1-byte flags, 4-byte sequence, 4-byte length, 4-byte check value, optional 32-byte HMAC, variable-length payload">
            {/* Byte offset labels */}
            {[0,2,3,4,5,9,13,17].map((off, i, arr) => (
              <text key={off} x={20 + (off / 17) * 700} y="20" textAnchor="middle" fill="var(--text-muted)" fontSize="10">{off}</text>
            ))}
            {/* Field boxes */}
            <rect x="20"  y="30" width={82}  height="40" rx="4" fill="rgba(34,211,238,0.1)" stroke="var(--accent)" strokeWidth="1" />
            <text x="61"  y="55" textAnchor="middle" fill="var(--accent)" fontSize="11" fontWeight="600">MAGIC "FT"</text>

            <rect x="102" y="30" width={41}  height="40" rx="4" fill="rgba(34,211,238,0.1)" stroke="var(--accent)" strokeWidth="1" />
            <text x="122" y="55" textAnchor="middle" fill="var(--text)" fontSize="10">VER</text>

            <rect x="143" y="30" width={41}  height="40" rx="4" fill="rgba(34,211,238,0.1)" stroke="var(--accent)" strokeWidth="1" />
            <text x="163" y="55" textAnchor="middle" fill="var(--text)" fontSize="10">TYPE</text>

            <rect x="184" y="30" width={41}  height="40" rx="4" fill="rgba(34,211,238,0.1)" stroke="var(--accent)" strokeWidth="1" />
            <text x="204" y="55" textAnchor="middle" fill="var(--text)" fontSize="10">FLAGS</text>

            <rect x="225" y="30" width={165} height="40" rx="4" fill="rgba(34,211,238,0.1)" stroke="var(--accent)" strokeWidth="1" />
            <text x="307" y="55" textAnchor="middle" fill="var(--text)" fontSize="10">SEQ (4 B)</text>

            <rect x="390" y="30" width={165} height="40" rx="4" fill="rgba(34,211,238,0.1)" stroke="var(--accent)" strokeWidth="1" />
            <text x="472" y="55" textAnchor="middle" fill="var(--text)" fontSize="10">LEN (4 B)</text>

            <rect x="555" y="30" width={165} height="40" rx="4" fill="rgba(34,211,238,0.1)" stroke="var(--accent)" strokeWidth="1" />
            <text x="637" y="55" textAnchor="middle" fill="var(--text)" fontSize="10">CHECK (4 B)</text>

            {/* Below: optional HMAC + payload */}
            <rect x="20" y="80" width="350" height="30" rx="4" fill="rgba(168,85,247,0.1)" stroke="var(--purple)" strokeWidth="1" strokeDasharray="4 3" />
            <text x="195" y="100" textAnchor="middle" fill="var(--purple)" fontSize="10">HMAC-SHA256 (32 B, if FLAGS bit 0)</text>

            <rect x="380" y="80" width="340" height="30" rx="4" fill="rgba(34,197,94,0.1)" stroke="var(--green)" strokeWidth="1" />
            <text x="550" y="100" textAnchor="middle" fill="var(--green)" fontSize="10">PAYLOAD (LEN bytes)</text>
          </svg>
        </div>
      </section>

      <section className="card">
        <h3>Stop-and-wait ARQ sequence</h3>
        <div className="diagram-container">
          <svg viewBox="0 0 500 300" className="seq-svg" role="img" aria-label="Sequence diagram showing META, ACK, DATA, NACK, retransmit, DONE, RESULT exchange between client and server">
            {/* Lifelines */}
            <line x1="100" y1="30" x2="100" y2="290" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="4 3" />
            <line x1="400" y1="30" x2="400" y2="290" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="4 3" />
            <text x="100" y="20" textAnchor="middle" fill="var(--text)" fontSize="12" fontWeight="600">Client</text>
            <text x="400" y="20" textAnchor="middle" fill="var(--text)" fontSize="12" fontWeight="600">Server</text>

            {/* Messages */}
            <line x1="105" y1="50" x2="395" y2="60" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#seq-arrow)" />
            <text x="250" y="48" textAnchor="middle" fill="var(--accent)" fontSize="10">META (name, size, sha256)</text>

            <line x1="395" y1="80" x2="105" y2="90" stroke="var(--green)" strokeWidth="1.5" markerEnd="url(#seq-arrow-green)" />
            <text x="250" y="78" textAnchor="middle" fill="var(--green)" fontSize="10">ACK 0</text>

            <line x1="105" y1="110" x2="395" y2="120" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#seq-arrow)" />
            <text x="250" y="108" textAnchor="middle" fill="var(--accent)" fontSize="10">DATA seq=0</text>

            <line x1="395" y1="140" x2="105" y2="150" stroke="var(--green)" strokeWidth="1.5" markerEnd="url(#seq-arrow-green)" />
            <text x="250" y="138" textAnchor="middle" fill="var(--green)" fontSize="10">ACK 0</text>

            <line x1="105" y1="170" x2="395" y2="180" stroke="var(--accent)" strokeWidth="1.5" markerEnd="url(#seq-arrow)" />
            <text x="250" y="168" textAnchor="middle" fill="var(--accent)" fontSize="10">DATA seq=1</text>

            <line x1="395" y1="200" x2="105" y2="210" stroke="var(--red)" strokeWidth="1.5" markerEnd="url(#seq-arrow-red)" />
            <text x="250" y="198" textAnchor="middle" fill="var(--red)" fontSize="10">NACK 1 "checksum_fail"</text>

            <line x1="105" y1="225" x2="395" y2="235" stroke="var(--amber)" strokeWidth="1.5" markerEnd="url(#seq-arrow-amber)" />
            <text x="250" y="223" textAnchor="middle" fill="var(--amber)" fontSize="10">DATA seq=1 (retransmit)</text>

            <line x1="395" y1="255" x2="105" y2="265" stroke="var(--green)" strokeWidth="1.5" markerEnd="url(#seq-arrow-green)" />
            <text x="250" y="253" textAnchor="middle" fill="var(--green)" fontSize="10">ACK 1</text>

            <text x="250" y="280" textAnchor="middle" fill="var(--text-muted)" fontSize="10">... DONE / RESULT ...</text>

            <defs>
              <marker id="seq-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <path d="M0,0 L8,3 L0,6" fill="none" stroke="var(--accent)" strokeWidth="1" />
              </marker>
              <marker id="seq-arrow-green" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <path d="M0,0 L8,3 L0,6" fill="none" stroke="var(--green)" strokeWidth="1" />
              </marker>
              <marker id="seq-arrow-red" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <path d="M0,0 L8,3 L0,6" fill="none" stroke="var(--red)" strokeWidth="1" />
              </marker>
              <marker id="seq-arrow-amber" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <path d="M0,0 L8,3 L0,6" fill="none" stroke="var(--amber)" strokeWidth="1" />
              </marker>
            </defs>
          </svg>
        </div>
      </section>

      <section className="card">
        <h3>Error handling comparison</h3>
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Mechanism</th>
              <th>Detects</th>
              <th>Corrects</th>
              <th>Overhead</th>
              <th>Used for</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>16-bit checksum</td>
              <td>Most 1-bit errors</td>
              <td>No</td>
              <td>2 bytes per chunk</td>
              <td>Default error detection</td>
            </tr>
            <tr>
              <td>CRC32</td>
              <td>All 1, 2, 3-bit errors, most bursts</td>
              <td>No</td>
              <td>4 bytes per chunk</td>
              <td>Stronger comparison detector</td>
            </tr>
            <tr>
              <td>Hamming(7,4)</td>
              <td>1-bit errors</td>
              <td>1-bit errors</td>
              <td>2x payload size</td>
              <td>Forward error correction</td>
            </tr>
            <tr>
              <td>SHA-256</td>
              <td>Any difference</td>
              <td>No</td>
              <td>32 bytes per file</td>
              <td>Whole-file verification</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
