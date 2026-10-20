import { COLORS } from "../../utils/constants";
import "./ResultCard.css";

function truncHash(h) {
  if (!h) return "—";
  return h.slice(0, 16) + "...";
}

function buildSummary(verified, objective, nacked, corrected, total) {
  if (!objective) {
    if (verified) {
      return "The file was transferred successfully. The received file is identical to the original.";
    }
    return "The transfer completed but the received file does not match the original. Some corruption went undetected.";
  }

  switch (objective.id) {
    case "O1":
      if (verified) {
        return `All ${total} chunks were sent over TCP through the proxy in clean mode (no errors injected). Every chunk was accepted on the first attempt. The SHA-256 hash of the received file matches the original, confirming the file arrived intact.`;
      }
      return "The transfer failed unexpectedly. Even without injected noise, the file did not arrive intact.";

    case "O2":
      if (verified) {
        return `The proxy randomly flipped bits in some chunks to simulate a noisy channel. The server's 16-bit checksum detected ${nacked} corrupted chunk${nacked !== 1 ? "s" : ""} and sent a NACK for each. The client retransmitted those chunks until they passed. The final file matches the original.`;
      }
      return "Some corrupted chunks slipped past the checksum. The file's SHA-256 does not match the original.";

    case "O3":
      if (verified) {
        return `The proxy flipped bits in some chunks, but Hamming(7,4) forward error correction was enabled. The server corrected ${corrected} single-bit error${corrected !== 1 ? "s" : ""} without asking the client to resend. Zero retransmissions were needed. The final file matches the original.`;
      }
      return "Hamming correction was not enough. Some chunks had multi-bit errors that Hamming could not fix.";

    case "O4":
      return null;

    default:
      return verified
        ? "The file transferred successfully and the SHA-256 hash matches."
        : "The transfer completed but the SHA-256 hash does not match.";
  }
}

function buildExplanation(verified, objective) {
  if (!objective) {
    return verified
      ? "The server computed the SHA-256 hash of the received file and compared it with the hash the client sent at the start. They match, so no data was lost or altered during transfer."
      : "The server computed the SHA-256 hash of the received file. It does not match the hash the client sent, meaning some data was corrupted and not caught by the per-chunk error check.";
  }

  switch (objective.id) {
    case "O1":
      return "This objective tests the basic transfer pipeline. The client splits the file into chunks, sends each one over TCP through the proxy (in clean mode), and waits for an ACK before sending the next. The server reassembles the chunks and verifies the whole file with SHA-256.";

    case "O2":
      return "This objective tests error detection. The proxy flips random bits in 30% of the chunks to simulate a noisy network. For each chunk, the server recomputes the 16-bit Internet checksum and compares it to the checksum in the frame header. If they differ, the server sends a NACK and the client retransmits that chunk. This is the stop-and-wait ARQ (Automatic Repeat reQuest) mechanism.";

    case "O3":
      return "This objective tests forward error correction. With Hamming(7,4), each 4 data bits are encoded into 7 bits (4 data + 3 parity). When a single bit is flipped, the server calculates a 3-bit syndrome that points to the flipped bit and corrects it in place, no retransmission needed. If 2 bits are flipped in one codeword, Hamming miscorrects it, but the checksum/CRC detects the error and triggers a retransmission.";

    case "O4":
      return null;

    default:
      return null;
  }
}

export default function ResultCard({ result, objective, completed, chunks, label }) {
  const verified = result.verified;

  const nacked = chunks.filter((c) => c.status === "nacked").length;
  const corrected = chunks.filter((c) => c.status === "corrected").length;
  const accepted = chunks.filter((c) => c.status === "accepted").length;
  const damaged = chunks.filter((c) => c.status === "damaged").length;
  const total = chunks.length;

  const summary = label
    ? null
    : buildSummary(verified, objective, nacked, corrected, total);
  const explanation = label
    ? null
    : buildExplanation(verified, objective);

  return (
    <div className={`result-card card ${verified ? "verified" : "rejected"}`}>
      {label && <p className="result-run-label">{label}</p>}
      <h2 className="result-title">{verified ? "VERIFIED" : "REJECTED"}</h2>

      {summary && <p className="result-summary">{summary}</p>}

      {label && (
        <p className="result-summary">
          {verified
            ? `The ${label.includes("CRC") ? "CRC32" : "checksum"} detected the word-swap corruption. Damaged chunks were retransmitted and the file was verified.`
            : `The ${label.includes("CRC") ? "CRC32" : "16-bit checksum"} did not detect the word swap. Two 16-bit words were swapped inside some chunks, which leaves the checksum unchanged. The file failed SHA-256 verification.`}
        </p>
      )}

      <div className="result-section">
        <h4 className="result-section-title">Transfer details</h4>
        {objective && (
          <div className="result-row">
            <span className="result-label">Objective</span>
            <span>{objective.label}</span>
          </div>
        )}
        {objective && (
          <div className="result-row">
            <span className="result-label">Expected</span>
            <span>{objective.expected}</span>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="result-section">
          <h4 className="result-section-title">Chunk statistics</h4>
          <div className="result-row">
            <span className="result-label">Total sent</span>
            <span>{total} chunks</span>
          </div>
          {nacked > 0 && (
            <div className="result-row">
              <span className="result-label">Detected bad</span>
              <span className="result-value-warn">
                {nacked} chunk{nacked !== 1 ? "s" : ""} failed the error check and were retransmitted
              </span>
            </div>
          )}
          {corrected > 0 && (
            <div className="result-row">
              <span className="result-label">Hamming fixed</span>
              <span className="result-value-fix">
                {corrected} chunk{corrected !== 1 ? "s" : ""} had 1-bit errors corrected without retransmission
              </span>
            </div>
          )}
          {damaged > 0 && (
            <div className="result-row">
              <span className="result-label">Undetected</span>
              <span className="result-value-bad">
                {damaged} corrupted chunk{damaged !== 1 ? "s" : ""} passed the error check (not caught)
              </span>
            </div>
          )}
          <div className="result-row">
            <span className="result-label">Accepted</span>
            <span>{accepted} of {total} chunks</span>
          </div>
        </div>
      )}

      <div className="result-section">
        <h4 className="result-section-title">SHA-256 file verification</h4>
        <div className="result-row">
          <span className="result-label">Sent hash</span>
          <span className="mono">{truncHash(result.expected)}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Received hash</span>
          <span className="mono">{truncHash(result.got)}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Match</span>
          <span className={verified ? "chip green" : "chip red"}>
            {verified ? "Yes -- file is identical" : "No -- file is corrupted"}
          </span>
        </div>
      </div>

      {objective && completed !== undefined && (
        <div className="result-section">
          <div className="result-row">
            <span className="result-label">Objective met</span>
            <span className={completed ? "chip green" : "chip red"}>
              {completed ? "Yes" : "No"}
            </span>
          </div>
        </div>
      )}

      {explanation && (
        <details className="result-why" open>
          <summary>How this works</summary>
          <p className="muted">{explanation}</p>
        </details>
      )}

      {chunks.length > 0 && <ChunkMap chunks={chunks} />}
    </div>
  );
}

function ChunkMap({ chunks }) {
  const usedStatuses = [...new Set(chunks.map((c) => c.status))];
  const legendLabels = {
    accepted: "Accepted (no errors)",
    nacked: "Error detected, retransmitted",
    corrected: "Corrected by Hamming (no retransmit)",
    damaged: "Corrupted (undetected)",
    travelling: "In transit",
  };

  return (
    <div className="chunk-map">
      <p className="chunk-map-title">Chunk map (each square = one chunk)</p>
      <div className="chunk-map-grid">
        {chunks.map((c, i) => (
          <span
            key={i}
            className="chunk-cell"
            style={{ backgroundColor: COLORS[c.status] || COLORS.travelling }}
            title={`Chunk ${c.seq}: ${c.status}`}
          />
        ))}
      </div>
      <div className="chunk-legend">
        {usedStatuses.map((s) => (
          <span key={s} className="chunk-legend-item">
            <span className="chunk-legend-dot" style={{ backgroundColor: COLORS[s] }} />
            {legendLabels[s] || s}
          </span>
        ))}
      </div>
    </div>
  );
}
