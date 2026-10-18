import { useState } from "react";
import { solveNumerical } from "../../utils/api";
import StepList from "./StepList";

export default function CrcSolver() {
  const [input, setInput] = useState("11010011");
  const [gen, setGen] = useState("crc3");
  const [flips, setFlips] = useState([]);
  const [sol, setSol] = useState(null);
  const [err, setErr] = useState("");

  async function solve(flipOverride) {
    setErr("");
    try {
      const res = await solveNumerical({
        kind: "crc",
        input,
        mode: "bin",
        generator: gen,
        flips: flipOverride || flips,
      });
      setSol(res.solution);
    } catch (e) {
      setErr(e.message);
    }
  }

  function toggleFlip(i) {
    const next = flips.includes(i) ? flips.filter((f) => f !== i) : [...flips, i];
    setFlips(next);
    if (sol) solve(next);
  }

  return (
    <div>
      <div className="solver-form">
        <label>
          Data (binary)
          <input value={input} onChange={(e) => setInput(e.target.value)} style={{ width: 250 }} />
        </label>
        <label>
          Generator
          <select value={gen} onChange={(e) => setGen(e.target.value)}>
            <option value="crc3">CRC-3 (1011)</option>
            <option value="crc4">CRC-4 (10011)</option>
            <option value="crc8">CRC-8 (100000111)</option>
          </select>
        </label>
        <button className="btn-solve" onClick={() => solve()}>Solve</button>
      </div>

      {err && <p style={{ color: "var(--red)", fontSize: "0.85rem" }}>{err}</p>}

      {sol && (
        <div>
          <StepList steps={sol.sender} label="Sender: division" />

          {sol.transmitted && (
            <>
              <h4 style={{ margin: "16px 0 8px", fontSize: "0.9rem", textAlign: "center" }}>
                Transmitted codeword (click a bit to flip it)
              </h4>
              <div className="bit-strip">
                {sol.transmitted.split("").map((b, i) => (
                  <button
                    key={i}
                    className={`bit-cell ${flips.includes(i) ? "flipped" : ""}`}
                    onClick={() => toggleFlip(i)}
                    title={`Bit ${i}`}
                  >
                    {flips.includes(i) ? (b === "0" ? "1" : "0") : b}
                  </button>
                ))}
              </div>
            </>
          )}

          <StepList steps={sol.receiver} label="Receiver: verification" />

          <div className={`step-verdict ${sol.verdict?.status === "accept" ? "ok" : "bad"}`}>
            {sol.verdict?.text || "Done"}
          </div>
        </div>
      )}
    </div>
  );
}
