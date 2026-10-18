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

export default function CalculatorTab() {
  const [solver, setSolver] = useState("checksum");

  return (
    <div className="calculator">
      <div className="solver-tabs">
        {SOLVERS.map((s) => (
          <button
            key={s.id}
            className={`solver-tab ${solver === s.id ? "active" : ""}`}
            onClick={() => setSolver(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="solver-content card">
        {solver === "checksum" && <ChecksumSolver />}
        {solver === "hamming" && <HammingSolver />}
        {solver === "crc" && <CrcSolver />}
      </div>
    </div>
  );
}
