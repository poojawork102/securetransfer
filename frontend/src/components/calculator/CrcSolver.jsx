import { useState, useEffect, useRef } from "react";
import { solveNumerical } from "../../utils/api";
import StepList from "./StepList";

export default function CrcSolver({ prefill, onPrefillUsed }) {
  const [input, setInput] = useState("11010011");
  const [mode, setMode] = useState("bin");
  const [gen, setGen] = useState("crc3");
  const [flips, setFlips] = useState([]);
  const [sol, setSol] = useState(null);
  const [err, setErr] = useState("");
  const prefillRef = useRef(null);

  useEffect(() => {
    if (prefill && prefill !== prefillRef.current) {
      prefillRef.current = prefill;
      if (prefill.input) setInput(prefill.input);
      if (prefill.generator) setGen(prefill.generator);
      setFlips(prefill.flips || []);
      onPrefillUsed?.();
      setTimeout(() => {
        solveNumerical({
          kind: "crc", input: prefill.input || input, mode: prefill.mode || mode,
          generator: prefill.generator || gen, flips: prefill.flips || [],
        })
          .then((res) => setSol(res.solution))
          .catch((e) => setErr(e.message));
      }, 50);
    }
  }, [prefill]);

  async function solve(flipOverride) {
    setErr("");
    try {
      const res = await solveNumerical({
        kind: "crc",
        input,
        mode,
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
          Input mode
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="bin">Binary</option>
            <option value="hex">Hex (0x...)</option>
            <option value="text">Text</option>
          </select>
        </label>
        <label>
          Data
          <input value={input} onChange={(e) => setInput(e.target.value)} style={{ width: 250 }} />
        </label>
        <label>
          Generator
          <select value={["crc3", "crc4", "crc8", "crc16", "crc32"].includes(gen) ? gen : "custom"} onChange={(e) => setGen(e.target.value === "custom" ? "10011" : e.target.value)}>
            <option value="crc3">CRC-3 (1011)</option>
            <option value="crc4">CRC-4 (10011)</option>
            <option value="crc8">CRC-8 (100000111)</option>
            <option value="crc16">CRC-16 (11000000000000101)</option>
            <option value="crc32">CRC-32</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {!["crc3", "crc4", "crc8", "crc16", "crc32"].includes(gen) && (
          <label>
            Generator polynomial (binary, starts with 1)
            <input value={gen} onChange={(e) => setGen(e.target.value)} style={{ width: 200 }} />
          </label>
        )}
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
