import { COLORS } from "../../utils/constants";
import "./ResultCard.css";

function evaluateObjective(objectiveId, verified, nacked, corrected, damaged, label) {
  const checks = [];

  switch (objectiveId) {
    case "O1":
      checks.push({ metric: "SHA-256 match", expected: "Yes", observed: verified ? "Yes" : "No", pass: verified });
      checks.push({ metric: "Retransmissions", expected: "0", observed: String(nacked), pass: nacked === 0 });
      break;

    case "O2":
      checks.push({ metric: "SHA-256 match", expected: "Yes", observed: verified ? "Yes" : "No", pass: verified });
      checks.push({ metric: "Corrupted chunks detected", expected: "> 0", observed: String(nacked), pass: nacked > 0 });
      checks.push({ metric: "Undetected corruptions", expected: "0", observed: String(damaged), pass: damaged === 0 });
      break;

    case "O3":
      checks.push({ metric: "SHA-256 match", expected: "Yes", observed: verified ? "Yes" : "No", pass: verified });
      checks.push({ metric: "Retransmissions", expected: "0", observed: String(nacked), pass: nacked === 0 });
      checks.push({ metric: "Bits corrected", expected: "> 0", observed: String(corrected), pass: corrected > 0 });
      break;

    case "O4":
      if (label && label.includes("Checksum")) {
        checks.push({ metric: "Undetected swaps", expected: "> 0", observed: String(damaged), pass: damaged > 0 });
        checks.push({ metric: "SHA-256 match", expected: "No", observed: verified ? "Yes" : "No", pass: !verified });
      } else if (label && label.includes("CRC")) {
        checks.push({ metric: "Corruptions detected", expected: "> 0", observed: String(nacked), pass: nacked > 0 });
        checks.push({ metric: "SHA-256 match", expected: "Yes", observed: verified ? "Yes" : "No", pass: verified });
      }
      break;

    default:
      return null;
  }

  return checks.length > 0 ? checks : null;
}

function truncHash(h) {
  if (!h) return "---";
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
      if (verified && nacked > 0) {
        return `The proxy randomly flipped bits in ${nacked} of ${total} chunks. The server's 16-bit checksum caught every one and sent a NACK. The client retransmitted those chunks until they passed. The final file matches the original.`;
      }
      if (verified && nacked === 0) {
        return `The proxy was set to 30% error rate but none of the ${total} chunks happened to be corrupted this run. The file arrived intact. Try again with a larger file for a more interesting result.`;
      }
      return "Some corrupted chunks slipped past the checksum. The file's SHA-256 does not match the original.";

    case "O3":
      if (verified && corrected > 0) {
        return `The proxy flipped bits in ${corrected} of ${total} chunks. Hamming(7,4) corrected every single-bit error in place -- zero retransmissions needed. The final file matches the original.`;
      }
      if (verified && corrected === 0) {
        return `The proxy was set to inject errors but none of the ${total} chunks were corrupted this run. Try again with a larger file to see Hamming correction in action.`;
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

export default function ResultCard({ result, objective, completed, chunks, label, onOpenCalculator }) {
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

  const checks = objective
    ? evaluateObjective(objective.id, verified, nacked, corrected, damaged, label)
    : null;
  const allPass = checks ? checks.every((c) => c.pass) : null;

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
        <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 8 }}>
          Before sending, the client computes the SHA-256 hash of the original file and
          includes it in the META frame. After receiving all chunks, the server reassembles
          the file and computes its own SHA-256 hash. These two hashes are compared below.
          There is no external database — verification is self-contained within each transfer.
        </p>
        <div className="result-row">
          <span className="result-label">Sender hash</span>
          <span className="mono">{truncHash(result.expected)}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Receiver hash</span>
          <span className="mono">{truncHash(result.got)}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Match</span>
          <span className={verified ? "chip green" : "chip red"}>
            {verified ? "Yes -- file is identical" : "No -- file is corrupted"}
          </span>
        </div>
      </div>

      {checks && (
        <div className="result-section">
          <h4 className="result-section-title">
            Expected vs Observed
            <span className={`chip ${allPass ? "green" : "red"}`} style={{ marginLeft: 10 }}>
              {allPass ? "PASS" : "FAIL"}
            </span>
          </h4>
          <table className="eval-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Expected</th>
                <th>Observed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c, i) => (
                <tr key={i}>
                  <td>{c.metric}</td>
                  <td className="mono">{c.expected}</td>
                  <td className="mono">{c.observed}</td>
                  <td>
                    <span className={`chip ${c.pass ? "green" : "red"}`} style={{ fontSize: "0.72rem" }}>
                      {c.pass ? "PASS" : "FAIL"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {explanation && (
        <details className="result-why" open>
          <summary>How this works</summary>
          <p className="muted">{explanation}</p>
        </details>
      )}

      {chunks.length > 0 && <ChunkMap chunks={chunks} onOpenCalculator={onOpenCalculator} objective={objective} />}
    </div>
  );
}

function makeCalcPrefill(chunk, objective) {
  const seed = ((chunk.seq || 0) * 7 + 13) & 0xff;
  const byte1 = seed.toString(2).padStart(8, "0");
  const byte2 = ((seed ^ 0x3c) & 0xff).toString(2).padStart(8, "0");

  if (chunk.status === "corrected" || objective?.id === "O3") {
    const nibble = byte1.slice(0, 4);
    return { solver: "hamming", input: nibble, flips: [2] };
  }
  if (chunk.status === "nacked" || chunk.status === "damaged") {
    return { solver: "checksum", input: byte1 + " " + byte2, word: 8 };
  }
  return null;
}

function ChunkMap({ chunks, onOpenCalculator, objective }) {
  const usedStatuses = [...new Set(chunks.map((c) => c.status))];
  const legendLabels = {
    accepted: "Accepted (no errors)",
    nacked: "Error detected, retransmitted",
    corrected: "Corrected by Hamming (no retransmit)",
    damaged: "Corrupted (undetected)",
    travelling: "In transit",
  };
  const clickable = new Set(["nacked", "corrected", "damaged"]);

  return (
    <div className="chunk-map">
      <p className="chunk-map-title">
        Chunk map (each square = one chunk)
        {onOpenCalculator && <span className="muted" style={{ marginLeft: 8, fontSize: "0.72rem" }}>Click an error chunk to try it in the Calculator</span>}
      </p>
      <div className="chunk-map-grid">
        {chunks.map((c, i) => {
          const isClickable = clickable.has(c.status) && onOpenCalculator;
          return (
            <span
              key={i}
              className={`chunk-cell ${isClickable ? "chunk-cell-clickable" : ""}`}
              style={{ backgroundColor: COLORS[c.status] || COLORS.travelling }}
              title={`Chunk ${c.seq}: ${c.status}${isClickable ? " (click to open in Calculator)" : ""}`}
              onClick={isClickable ? () => onOpenCalculator(makeCalcPrefill(c, objective)) : undefined}
            />
          );
        })}
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
