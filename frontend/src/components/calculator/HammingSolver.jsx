import { useState, useEffect, useRef } from "react";
import { solveNumerical } from "../../utils/api";
import StepList from "./StepList";

const HAMMING_PRESETS = [
  { label: "Hamming(7,4) - 4 data bits", bits: 4 },
  { label: "Hamming(12,8) - 8 data bits", bits: 8 },
  { label: "Hamming(15,11) - 11 data bits", bits: 11 },
  { label: "Hamming(21,16) - 16 data bits", bits: 16 },
  { label: "Custom", bits: 0 },
];

export default function HammingSolver({ prefill, onPrefillUsed }) {
  const [input, setInput] = useState("1011");
  const [preset, setPreset] = useState(4);
  const [flips, setFlips] = useState([]);
  const [sol, setSol] = useState(null);
  const [err, setErr] = useState("");
  const prefillRef = useRef(null);

  useEffect(() => {
    if (prefill && prefill !== prefillRef.current) {
      prefillRef.current = prefill;
      if (prefill.input) setInput(prefill.input);
      const len = (prefill.input || "").replace(/\s/g, "").length;
      const match = HAMMING_PRESETS.find((p) => p.bits === len);
      setPreset(match ? len : 0);
      setFlips(prefill.flips || []);
      onPrefillUsed?.();
      setTimeout(() => {
        solveNumerical({
          kind: "hamming", input: prefill.input || input, mode: "bin",
          scheme: "74", parity: "even", flips: prefill.flips || [],
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
          Scheme
          <select
            value={HAMMING_PRESETS.find((p) => p.bits === preset) ? preset : 0}
            onChange={(e) => {
              const bits = parseInt(e.target.value);
              setPreset(bits);
              if (bits > 0) {
                setInput("1".repeat(bits));
                setFlips([]);
                setSol(null);
              }
            }}
          >
            {HAMMING_PRESETS.map((p) => (
              <option key={p.bits} value={p.bits}>{p.label}</option>
            ))}
          </select>
        </label>
        <label>
          Data bits (binary, up to 26 bits)
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const len = e.target.value.replace(/\s/g, "").length;
              const match = HAMMING_PRESETS.find((p) => p.bits === len);
              setPreset(match ? len : 0);
            }}
            style={{ width: 200 }}
          />
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
                  const isParity = (sol.extra?.parity_positions || [1, 2, 4]).map(p => p - 1).includes(i);
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
