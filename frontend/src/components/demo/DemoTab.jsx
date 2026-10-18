import { useState, useEffect, useCallback } from "react";
import ObjectiveStepper from "./ObjectiveStepper";
import Stage3D from "./Stage3D";
import WhatsHappening from "./WhatsHappening";
import ResultCard from "./ResultCard";
import { OBJECTIVES } from "../../utils/constants";
import { sendFile, setProxy, getSamples } from "../../utils/api";
import "./DemoTab.css";

export default function DemoTab({ socket }) {
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState({});
  const [activeObj, setActiveObj] = useState(null);
  const [result, setResult] = useState(null);
  const [happenings, setHappenings] = useState([]);
  const [chunks, setChunks] = useState([]);
  const [samples, setSamples] = useState([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  useEffect(() => {
    getSamples().then(setSamples).catch(() => {});
  }, []);

  const addHappening = useCallback((text, type = "info") => {
    setHappenings((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.text === text) {
        return [...prev.slice(0, -1), { ...last, count: (last.count || 1) + 1 }];
      }
      const trimmed = prev.length >= 6 ? prev.slice(-5) : prev;
      return [...trimmed, { text, type, count: 1 }];
    });
  }, []);

  useEffect(() => {
    return socket.onTelemetry((ev) => {
      if (ev.ev === "chunk_sent") {
        setChunks((prev) => [...prev, { seq: ev.seq, status: "travelling" }]);
        addHappening(`Client sends chunk ${ev.seq}.`);
      } else if (ev.ev === "chunk_ok") {
        setChunks((prev) =>
          prev.map((c) => (c.seq === ev.seq ? { ...c, status: "accepted" } : c))
        );
      } else if (ev.ev === "chunk_nack") {
        setChunks((prev) =>
          prev.map((c) => (c.seq === ev.seq ? { ...c, status: "nacked" } : c))
        );
        const reason = ev.reason || "checksum mismatch";
        addHappening(
          `Server recomputes the checksum of chunk ${ev.seq}: ${reason}, sends NACK, chunk is re-sent.`,
          "warn"
        );
      } else if (ev.ev === "chunk_fixed") {
        setChunks((prev) =>
          prev.map((c) => (c.seq === ev.seq ? { ...c, status: "corrected" } : c))
        );
        addHappening(
          `Hamming corrects a 1-bit error in chunk ${ev.seq}, no retransmission needed.`,
          "fix"
        );
      } else if (ev.ev === "corrupt") {
        setChunks((prev) =>
          prev.map((c) => (c.seq === ev.seq ? { ...c, status: "damaged" } : c))
        );
      } else if (ev.ev === "result") {
        const verified = ev.match === true;
        setResult({
          verified,
          expected: ev.expected,
          got: ev.got,
        });
        setRunning(false);
        if (activeObj) {
          const obj = OBJECTIVES.find((o) => o.id === activeObj);
          if (obj) {
            const met = checkObjectiveMet(obj, ev);
            setCompleted((prev) => ({ ...prev, [activeObj]: met }));
          }
        }
      }
    });
  }, [socket, addHappening, activeObj]);

  function checkObjectiveMet(obj, resultEv) {
    if (obj.id === "O1") return resultEv.match === true;
    if (obj.id === "O2") return resultEv.match === true;
    if (obj.id === "O3") return resultEv.match === true;
    if (obj.id === "O4") return true;
    return resultEv.match === true;
  }

  async function runObjective(objId) {
    const obj = OBJECTIVES.find((o) => o.id === objId);
    if (!obj || running) return;

    setActiveObj(objId);
    setResult(null);
    setHappenings([]);
    setChunks([]);
    setRunning(true);
    setHasRun(true);

    const cfg = obj.config;
    await setProxy({
      mode: cfg.mode || "clean",
      rate: cfg.rate || 0,
      pattern: cfg.pattern || "random",
    });

    const fd = new FormData();
    const opts = {
      sample: samples[0]?.name || "sample.txt",
      check: cfg.check || "checksum16",
      fec: cfg.fec || false,
      hmac: cfg.hmac || false,
      chunk: 1024,
      auto: false,
    };
    fd.append("opts", JSON.stringify(opts));
    await sendFile(fd).catch(() => setRunning(false));
  }

  async function runCustom(opts) {
    setActiveObj(null);
    setResult(null);
    setHappenings([]);
    setChunks([]);
    setRunning(true);
    setHasRun(true);

    await setProxy({
      mode: opts.mode || "clean",
      rate: parseFloat(opts.rate) || 0,
    });

    const fd = new FormData();
    fd.append("opts", JSON.stringify({
      sample: opts.sample || samples[0]?.name || "sample.txt",
      check: opts.check || "checksum16",
      fec: opts.fec || false,
      hmac: opts.hmac || false,
      chunk: parseInt(opts.chunk) || 1024,
      auto: false,
    }));
    if (opts.file) fd.append("file", opts.file);
    await sendFile(fd).catch(() => setRunning(false));
  }

  useEffect(() => {
    const handler = (e) => {
      const key = e.key;
      if (["1", "2", "3", "4"].includes(key) && !running) {
        runObjective(OBJECTIVES[parseInt(key) - 1].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [running, samples]);

  const idle = !hasRun;

  if (idle) {
    return (
      <div className="demo-idle">
        <div className="demo-intro card">
          <h2 className="intro-title">Live file transfer demo</h2>
          <p className="intro-text">
            This sends a file over TCP through a fault-injecting proxy. Each objective
            tests a different error-handling mechanism. Click one to start.
          </p>
          <p className="intro-hint">Keyboard: press 1, 2, 3, or 4</p>
        </div>

        <div className="objective-cards">
          {OBJECTIVES.map((obj, i) => (
            <button
              key={obj.id}
              className="objective-card card"
              onClick={() => runObjective(obj.id)}
              disabled={running}
            >
              <span className="obj-num">{i + 1}</span>
              <div className="obj-body">
                <span className="obj-label">{obj.label}</span>
                <span className="obj-detail">{obj.detail}</span>
                <span className="obj-expected">{obj.expected}</span>
              </div>
            </button>
          ))}
        </div>

        <details
          className="custom-panel card"
          open={customOpen}
          onToggle={(e) => setCustomOpen(e.target.open)}
        >
          <summary>Custom run (choose your own settings)</summary>
          <CustomRunForm samples={samples} onRun={runCustom} running={running} />
        </details>
      </div>
    );
  }

  return (
    <div className="demo-tab">
      <div className="demo-left">
        <ObjectiveStepper
          objectives={OBJECTIVES}
          completed={completed}
          active={activeObj}
          running={running}
          onRun={runObjective}
        />
        <details
          className="custom-panel card"
          open={customOpen}
          onToggle={(e) => setCustomOpen(e.target.open)}
        >
          <summary>Custom run</summary>
          <CustomRunForm samples={samples} onRun={runCustom} running={running} />
        </details>
      </div>
      <div className="demo-main">
        <Stage3D chunks={chunks} running={running} />
        <WhatsHappening items={happenings} />
        {result && (
          <ResultCard
            result={result}
            objective={OBJECTIVES.find((o) => o.id === activeObj)}
            completed={completed[activeObj]}
            chunks={chunks}
          />
        )}
      </div>
    </div>
  );
}

function CustomRunForm({ samples, onRun, running }) {
  const [mode, setMode] = useState("clean");
  const [rate, setRate] = useState("0.2");
  const [check, setCheck] = useState("checksum16");
  const [fec, setFec] = useState(false);
  const [hmac, setHmac] = useState(false);
  const [sample, setSample] = useState("");

  return (
    <div className="custom-form">
      <label>
        File
        <select value={sample} onChange={(e) => setSample(e.target.value)}>
          <option value="">Default sample</option>
          {samples.map((s) => (
            <option key={s.name} value={s.name}>{s.name} ({(s.size / 1024).toFixed(1)} KB)</option>
          ))}
        </select>
      </label>
      <label>
        Network
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="clean">Clean</option>
          <option value="noise">Noise</option>
          <option value="attack">MITM attack</option>
        </select>
      </label>
      <label>
        Error rate
        <input type="number" min="0" max="1" step="0.05" value={rate} onChange={(e) => setRate(e.target.value)} />
      </label>
      <label>
        Check method
        <select value={check} onChange={(e) => setCheck(e.target.value)}>
          <option value="checksum16">16-bit checksum</option>
          <option value="crc32">CRC32</option>
        </select>
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={fec} onChange={(e) => setFec(e.target.checked)} />
        Hamming FEC
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={hmac} onChange={(e) => setHmac(e.target.checked)} />
        HMAC-SHA256
      </label>
      <button
        className="btn-send"
        disabled={running}
        onClick={() => onRun({ mode, rate, check, fec, hmac, sample })}
      >
        {running ? "Sending..." : "Send"}
      </button>
    </div>
  );
}
