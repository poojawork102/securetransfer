import { useState } from "react";
import { solveNumerical } from "../../utils/api";
import StepList from "./StepList";

export default function HammingSolver() {
  const [input, setInput] = useState("1011");
  const [flips, setFlips] = useState([]);
  const [sol, setSol] = useState(null);
  const [err, setErr] = useState("");

  async function solve(flipOverride) {
    setErr("");
    try {
      const res = await solveNumerical({
        kind: "hamming",
        input,
        mode: "bin",
        scheme: "74",
        parity: "even",
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
          Data bits (4 bits for Hamming 7,4)
          <input value={input} onChange={(e) => setInput(e.target.value)} style={{ width: 200 }} />
        </label>
        <button className="btn-solve" onClick={() => solve()}>Encode</button>
      </div>

      {err && <p style={{ color: "var(--red)", fontSize: "0.85rem" }}>{err}</p>}

      {sol && (
        <div>
          <StepList steps={sol.sender} label="Sender: encode" />

          {sol.transmitted && (
            <>
              <h4 style={{ margin: "16px 0 8px", fontSize: "0.9rem", textAlign: "center" }}>
                Transmitted codeword (click a bit to flip it)
              </h4>
              <div className="bit-strip">
                {sol.transmitted.split("").map((b, i) => {
                  const isParity = [0, 1, 3].includes(i);
                  return (
                    <button
                      key={i}
                      className={`bit-cell ${flips.includes(i) ? "flipped" : ""} ${isParity ? "parity" : ""}`}
                      onClick={() => toggleFlip(i)}
                      title={`Position ${i + 1}${isParity ? " (parity)" : " (data)"}`}
                    >
                      {flips.includes(i) ? (b === "0" ? "1" : "0") : b}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <StepList steps={sol.receiver} label="Receiver: decode" />

          <div className={`step-verdict ${sol.verdict?.status === "accept" || sol.verdict?.status === "corrected" ? "ok" : "bad"}`}>
            {sol.verdict?.text || "Done"}
          </div>
        </div>
      )}
    </div>
  );
}
