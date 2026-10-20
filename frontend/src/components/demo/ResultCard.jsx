import { useState } from "react";
import { COLORS } from "../../utils/constants";
import "./ResultCard.css";

export default function ResultCard({ result, objective, completed, chunks, label }) {
  const [whyOpen, setWhyOpen] = useState(false);
  const verified = result.verified;

  const nacked = chunks.filter((c) => c.status === "nacked").length;
  const corrected = chunks.filter((c) => c.status === "corrected").length;
  const accepted = chunks.filter((c) => c.status === "accepted").length;
  const total = chunks.length;

  return (
    <div className={`result-card card ${verified ? "verified" : "rejected"}`}>
      {label && <p className="result-run-label">{label}</p>}
      <h2 className="result-title">{verified ? "VERIFIED" : "REJECTED"}</h2>

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
      <div className="result-row">
        <span className="result-label">Observed</span>
        <span>
          SHA-256 {verified ? "match" : "mismatch"}
        </span>
      </div>
      {total > 0 && (
        <div className="result-row">
          <span className="result-label">Chunks</span>
          <span>{total} total, {nacked} retransmitted, {corrected} corrected, {accepted} accepted</span>
        </div>
      )}
      {objective && (
        <div className="result-row">
          <span className="result-label">Objective met</span>
          <span className={completed ? "chip green" : "chip red"}>
            {completed ? "Yes" : "No"}
          </span>
        </div>
      )}

      <details className="result-why" open={whyOpen} onToggle={(e) => setWhyOpen(e.target.open)}>
        <summary>Why</summary>
        <p className="muted">
          {verified
            ? "Every chunk passed the error check. The SHA-256 hash of the received file matches the hash sent in the META frame, confirming no data was lost or altered."
            : "One or more chunks were corrupted and the error was not corrected. The SHA-256 hash of the received file does not match the original, so the file was rejected."}
        </p>
      </details>

      {chunks.length > 0 && <ChunkMap chunks={chunks} />}
    </div>
  );
}

function ChunkMap({ chunks }) {
  const usedStatuses = [...new Set(chunks.map((c) => c.status))];
  const legendLabels = {
    accepted: "Accepted",
    nacked: "Detected, retransmitted",
    corrected: "Corrected by Hamming",
    damaged: "Damaged",
    travelling: "In transit",
  };

  return (
    <div className="chunk-map">
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
