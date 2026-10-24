import { useState } from "react";
import ChecksumSolver from "./ChecksumSolver";
import HammingSolver from "./HammingSolver";
import CrcSolver from "./CrcSolver";
import "./CalculatorTab.css";

const SOLVERS = [
  { id: "checksum", label: "Checksum" },
  { id: "hamming", label: "Hamming" },
  { id: "crc", label: "CRC" },
];

export default function CalculatorTab({ prefill, onPrefillUsed }) {
  const [solver, setSolver] = useState("checksum");

  const activeSolver = prefill?.solver || solver;
  if (prefill?.solver && prefill.solver !== solver) {
    setSolver(prefill.solver);
  }

  return (
    <div className="calculator">
      <div className="solver-tabs">
        {SOLVERS.map((s) => (
          <button
            key={s.id}
            className={`solver-tab ${activeSolver === s.id ? "active" : ""}`}
            onClick={() => setSolver(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="solver-content card">
        {activeSolver === "checksum" && <ChecksumSolver prefill={prefill?.solver === "checksum" ? prefill : null} onPrefillUsed={onPrefillUsed} />}
        {activeSolver === "hamming" && <HammingSolver prefill={prefill?.solver === "hamming" ? prefill : null} onPrefillUsed={onPrefillUsed} />}
        {activeSolver === "crc" && <CrcSolver prefill={prefill?.solver === "crc" ? prefill : null} onPrefillUsed={onPrefillUsed} />}
      </div>
    </div>
  );
}
