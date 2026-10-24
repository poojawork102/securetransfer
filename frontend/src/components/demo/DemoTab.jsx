import { useState, useEffect, useCallback, useRef } from "react";
import ObjectiveStepper from "./ObjectiveStepper";
import WhatsHappening from "./WhatsHappening";
import ResultCard from "./ResultCard";
import { OBJECTIVES } from "../../utils/constants";
import { sendFile, setProxy, getSamples } from "../../utils/api";
import "./DemoTab.css";

export default function DemoTab({ socket, onStateChange, onOpenCalculator }) {
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState({});
  const [activeObj, setActiveObj] = useState(null);
  const [result, setResult] = useState(null);
  const [compareResult, setCompareResult] = useState(null);
  const [happenings, setHappenings] = useState([]);
  const [chunks, setChunks] = useState([]);
  const [samples, setSamples] = useState([]);
  const [hasRun, setHasRun] = useState(false);
  const pendingCompare = useRef(false);
  const [selectedSample, setSelectedSample] = useState("");
  const [uploadedFile, setUploadedFile] = useState(null);

  useEffect(() => {
    getSamples().then(setSamples).catch(() => {});
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange({ running, activeObj });
  }, [running, activeObj, onStateChange]);

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

  const startCompareRun = useCallback(async () => {
    addHappening("Now running CRC32 for comparison...", "info");
    setChunks([]);
    const fd = new FormData();
    const opts = {
      sample: selectedSample || samples[0]?.name || "sample.txt",
      check: "crc32",
      fec: false,
      chunk: 256,
    };
    fd.append("opts", JSON.stringify(opts));
    if (uploadedFile) fd.append("file", uploadedFile);
    await sendFile(fd).catch(() => setRunning(false));
  }, [samples, addHappening, selectedSample, uploadedFile]);

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
        const thisResult = { verified, expected: ev.expected, got: ev.got };

        if (pendingCompare.current) {
          pendingCompare.current = false;
          setCompareResult(thisResult);
          setRunning(false);
          setCompleted((prev) => ({ ...prev, O4: true }));
        } else if (activeObj === "O4") {
          setResult(thisResult);
          pendingCompare.current = true;
          startCompareRun();
        } else {
          setResult(thisResult);
          setRunning(false);
          if (activeObj) {
            const obj = OBJECTIVES.find((o) => o.id === activeObj);
            if (obj) {
              const met = checkObjectiveMet(obj, ev);
              setCompleted((prev) => ({ ...prev, [activeObj]: met }));
            }
          }
        }
      }
    });
  }, [socket, addHappening, activeObj, startCompareRun]);

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
    setCompareResult(null);
    setHappenings([]);
    setChunks([]);
    setRunning(true);
    setHasRun(true);
    pendingCompare.current = false;

    const cfg = obj.config;
    await setProxy({
      mode: cfg.mode || "clean",
      rate: cfg.rate || 0,
      pattern: cfg.pattern || "random",
    });

    const fd = new FormData();
    const opts = {
      sample: selectedSample || samples[0]?.name || "sample.txt",
      check: cfg.check || "checksum16",
      fec: cfg.fec || false,
      chunk: 256,
    };
    fd.append("opts", JSON.stringify(opts));
    if (uploadedFile) fd.append("file", uploadedFile);
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

        <div className="file-selector card" style={{ marginBottom: 16 }}>
          <h4 style={{ margin: "0 0 8px", fontSize: "0.9rem" }}>File to transfer</h4>
          <div style={{ display: "flex", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
            <label>
              Sample file
              <select value={selectedSample} onChange={(e) => { setSelectedSample(e.target.value); setUploadedFile(null); }}>
                <option value="">sample.txt (default)</option>
                {samples.map((s) => (
                  <option key={s.name} value={s.name}>{s.name} ({(s.size / 1024).toFixed(1)} KB)</option>
                ))}
              </select>
            </label>
            <label>
              Or upload your own
              <input type="file" onChange={(e) => { if (e.target.files[0]) { setUploadedFile(e.target.files[0]); setSelectedSample(""); } }} />
            </label>
          </div>
          {uploadedFile && <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "var(--text-muted)" }}>Using uploaded file: {uploadedFile.name}</p>}
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

      </div>
    );
  }

  return (
    <div className="demo-tab">
      <div className="demo-left">
        <div className="file-selector card" style={{ marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 6px", fontSize: "0.85rem" }}>File to transfer</h4>
          <select value={selectedSample} onChange={(e) => { setSelectedSample(e.target.value); setUploadedFile(null); }} style={{ width: "100%" }}>
            <option value="">sample.txt (default)</option>
            {samples.map((s) => (
              <option key={s.name} value={s.name}>{s.name} ({(s.size / 1024).toFixed(1)} KB)</option>
            ))}
          </select>
          <input type="file" style={{ marginTop: 6, fontSize: "0.8rem" }} onChange={(e) => { if (e.target.files[0]) { setUploadedFile(e.target.files[0]); setSelectedSample(""); } }} />
          {uploadedFile && <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>Using: {uploadedFile.name}</p>}
        </div>
        <ObjectiveStepper
          objectives={OBJECTIVES}
          completed={completed}
          active={activeObj}
          running={running}
          onRun={runObjective}
        />
      </div>
      <div className="demo-main">
        <WhatsHappening items={happenings} />
        {activeObj === "O4" && result && compareResult ? (
          <div className="compare-cards">
            <ResultCard
              result={result}
              label="Run 1: Checksum"
              chunks={[]}
              onOpenCalculator={onOpenCalculator}
            />
            <ResultCard
              result={compareResult}
              label="Run 2: CRC32"
              chunks={chunks}
              onOpenCalculator={onOpenCalculator}
            />
          </div>
        ) : result ? (
          <ResultCard
            result={result}
            objective={OBJECTIVES.find((o) => o.id === activeObj)}
            completed={completed[activeObj]}
            chunks={chunks}
            onOpenCalculator={onOpenCalculator}
          />
        ) : null}
      </div>
    </div>
  );
}
