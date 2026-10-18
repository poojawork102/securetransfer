import { useState } from "react";
import { sendFile, setProxy } from "../../utils/api";
import "./BeyondTab.css";

export default function BeyondTab({ socket }) {
  return (
    <div className="beyond-tab">
      <div className="beyond-notice card">
        <p>
          These features go beyond the course brief (Topic 16: TCP file transfer with error verification).
          They are included to demonstrate deeper understanding of network security and adaptive systems.
        </p>
      </div>

      <section className="card">
        <h3>MITM attack vs HMAC-SHA256</h3>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 12 }}>
          The proxy intercepts chunks, replaces the payload with forged data, and recomputes the
          checksum so it still passes. Without HMAC, the server accepts the forged file.
          With HMAC-SHA256 (a keyed hash), the server rejects every forged chunk because the
          attacker cannot recompute the HMAC without the secret key.
        </p>
        <div className="beyond-demos">
          <DemoButton
            label="Attack without HMAC"
            config={{ mode: "attack", rate: 0.5, check: "checksum16", hmac: false, fec: false }}
            expected="File accepted but corrupted: SHA-256 mismatch"
            socket={socket}
          />
          <DemoButton
            label="Attack with HMAC"
            config={{ mode: "attack", rate: 0.5, check: "checksum16", hmac: true, fec: false }}
            expected="All forged chunks rejected, file verified"
            socket={socket}
          />
        </div>
      </section>

      <section className="card">
        <h3>Auto Defense (closed-loop control)</h3>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 12 }}>
          Instead of the user picking Hamming or HMAC manually, the client monitors error
          rates and adapts: it enables Hamming when errors exceed 10%, halves the chunk size
          during bursts, and retries with HMAC if the SHA-256 check fails.
        </p>
        <div className="beyond-demos">
          <DemoButton
            label="Auto Defense"
            config={{ mode: "noise", rate: 0.4, check: "checksum16", auto: true }}
            expected="Auto-adapts: enables Hamming, file verified"
            socket={socket}
          />
        </div>
      </section>

      <section className="card">
        <h3>Limitations</h3>
        <ul className="limitations-list">
          <li>Stop-and-wait ARQ is simple but slow on high-latency links. Sliding-window (Go-Back-N or Selective Repeat) would improve throughput.</li>
          <li>The HMAC key is pre-shared and hard-coded. A real system would use TLS or a key exchange.</li>
          <li>Hamming(7,4) corrects only one bit per 7-bit codeword. Real links use stronger codes (Reed-Solomon, LDPC).</li>
          <li>HMAC provides integrity and authenticity, not confidentiality: the data is readable in Wireshark.</li>
          <li>Auto Defense is reactive, not predictive: it cannot prevent the first failure.</li>
          <li>Mininet topology is not implemented. Multi-host testing uses two laptops on the same Wi-Fi.</li>
        </ul>
      </section>
    </div>
  );
}

function DemoButton({ label, config, expected, socket }) {
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    await setProxy({ mode: config.mode, rate: config.rate, pattern: config.pattern || "random" });
    const fd = new FormData();
    fd.append("opts", JSON.stringify({
      sample: "sample.txt",
      check: config.check || "checksum16",
      fec: config.fec || false,
      hmac: config.hmac || false,
      auto: config.auto || false,
      chunk: 1024,
    }));
    await sendFile(fd).catch(() => {});
    setTimeout(() => setRunning(false), 3000);
  }

  return (
    <div className="beyond-demo-item">
      <button className="btn-beyond" onClick={run} disabled={running}>
        {running ? "Running..." : label}
      </button>
      <span className="muted" style={{ fontSize: "0.8rem" }}>Expected: {expected}</span>
    </div>
  );
}
