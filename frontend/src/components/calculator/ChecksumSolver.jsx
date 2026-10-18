import { useState } from "react";
import { solveNumerical } from "../../utils/api";
import StepList from "./StepList";

export default function ChecksumSolver() {
  const [input, setInput] = useState("11001100 10101010 11110000");
  const [word, setWord] = useState("8");
  const [sol, setSol] = useState(null);
  const [err, setErr] = useState("");

  async function solve() {
    setErr("");
    try {
      const res = await solveNumerical({ kind: "checksum", input, mode: "bin", word: parseInt(word) });
      setSol(res.solution);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div>
      <div className="solver-form">
        <label>
          Data (binary or hex)
          <input value={input} onChange={(e) => setInput(e.target.value)} style={{ width: 300 }} />
        </label>
        <label>
          Word size
          <select value={word} onChange={(e) => setWord(e.target.value)}>
            <option value="8">8-bit</option>
            <option value="16">16-bit</option>
          </select>
        </label>
        <button className="btn-solve" onClick={solve}>Solve</button>
      </div>

      {err && <p style={{ color: "var(--red)", fontSize: "0.85rem" }}>{err}</p>}

      {sol && (
        <div>
          <StepList steps={sol.sender} label="Sender side" />
          <StepList steps={sol.receiver} label="Receiver side" />
          <div className={`step-verdict ${sol.verdict?.status === "accept" ? "ok" : "bad"}`}>
            {sol.verdict?.text || "Done"}
          </div>
        </div>
      )}
    </div>
  );
}
