import { useState, useEffect, useCallback, useRef } from "react";
import ObjectiveStepper from "./ObjectiveStepper";
import ResultCard from "./ResultCard";
import { OBJECTIVES } from "../../utils/constants";
import { sendFile, setProxy, getSamples } from "../../utils/api";
import "./DemoTab.css";

function upsertChunk(prev, seq, status) {
  const idx = prev.findIndex((c) => c.seq === seq);
  if (idx >= 0) {
    const copy = [...prev];
    copy[idx] = { ...copy[idx], status };
    return copy;
  }
  return [...prev, { seq, status }];
}

export default function DemoTab({ socket, onStateChange, onOpenCalculator }) {
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState({});
  const [activeObj, setActiveObj] = useState(null);
  const [result, setResult] = useState(null);
  const [compareResult, setCompareResult] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [firstRunChunks, setFirstRunChunks] = useState([]);
  const [samples, setSamples] = useState([]);
  const [hasRun, setHasRun] = useState(false);
  const pendingCompare = useRef(false);
  const [selectedSample, setSelectedSample] = useState("");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [toast, setToast] = useState(null);

  const activeObjRef = useRef(null);
  const chunksRef = useRef([]);
  const samplesRef = useRef([]);
  const selectedSampleRef = useRef("");
  const uploadedFileRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => { activeObjRef.current = activeObj; }, [activeObj]);
  useEffect(() => { chunksRef.current = chunks; }, [chunks]);
  useEffect(() => { samplesRef.current = samples; }, [samples]);
  useEffect(() => { selectedSampleRef.current = selectedSample; }, [selectedSample]);
  useEffect(() => { uploadedFileRef.current = uploadedFile; }, [uploadedFile]);

  useEffect(() => {
    getSamples().then(setSamples).catch(() => {});
  }, []);

  useEffect(() => {
    if (onStateChange) onStateChange({ running, activeObj });
  }, [running, activeObj, onStateChange]);

  function showToast(msg) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  const startCompareRun = useCallback(async () => {
    setFirstRunChunks(chunksRef.current);
    setChunks([]);
    showToast("Running CRC-32 comparison transfer...");
    const fd = new FormData();
    const opts = {
      sample: selectedSampleRef.current || samplesRef.current[0]?.name || "sample.txt",
      check: "crc32",
      fec: false,
      chunk: 1024,
      delay: 0,
    };
    fd.append("opts", JSON.stringify(opts));
    if (uploadedFileRef.current) fd.append("file", uploadedFileRef.current);
    await sendFile(fd).catch(() => setRunning(false));
  }, []);

  function checkObjectiveMet(obj, resultEv) {
    if (obj.id === "O1") return resultEv.match === true;
    if (obj.id === "O2") return resultEv.match === true;
    if (obj.id === "O3") return resultEv.match === true;
    if (obj.id === "O4") return true;
    return resultEv.match === true;
  }

  useEffect(() => {
    return socket.onTelemetry((ev) => {
      if (ev.src === "client" && ev.ev === "send") {
        if (ev.attempt === 1) {
          setChunks((prev) => {
            if (prev.some((c) => c.seq === ev.seq)) return prev;
            return [...prev, { seq: ev.seq, status: "travelling" }];
          });
        }
      } else if (ev.src === "server" && ev.ev === "chunk") {
        if (ev.status === "ok") {
          setChunks((prev) => {
            const existing = prev.find((c) => c.seq === ev.seq);
            if (existing?.status === "damaged") return prev;
            return upsertChunk(prev, ev.seq, "accepted");
          });
        } else if (ev.status === "corrected") {
          setChunks((prev) => upsertChunk(prev, ev.seq, "corrected"));
        } else if (ev.status === "crc_fail" || ev.status === "checksum_fail") {
          setChunks((prev) => upsertChunk(prev, ev.seq, "nacked"));
        }
      } else if (ev.src === "proxy" && ev.ev === "corrupt") {
        setChunks((prev) => upsertChunk(prev, ev.seq, "damaged"));
      } else if (ev.src === "server" && ev.ev === "result") {
        const verified = ev.match === true;
        const thisResult = { verified, expected: ev.expected, got: ev.got };

        if (pendingCompare.current) {
          pendingCompare.current = false;
          setCompareResult(thisResult);
          setRunning(false);
          setCompleted((prev) => ({ ...prev, O4: true }));
        } else if (activeObjRef.current === "O4") {
          setResult(thisResult);
          pendingCompare.current = true;
          startCompareRun();
        } else {
          setResult(thisResult);
          setRunning(false);
          const curObj = activeObjRef.current;
          if (curObj) {
            const obj = OBJECTIVES.find((o) => o.id === curObj);
            if (obj) {
              const met = checkObjectiveMet(obj, ev);
              setCompleted((prev) => ({ ...prev, [curObj]: met }));
            }
          }
        }
      }
    });
  }, [socket, startCompareRun]);

  async function runObjective(objId) {
    const obj = OBJECTIVES.find((o) => o.id === objId);
    if (!obj || running) return;

    setActiveObj(objId);
    setResult(null);
    setCompareResult(null);
    setChunks([]);
    setFirstRunChunks([]);
    setRunning(true);
    setHasRun(true);
    pendingCompare.current = false;

    showToast("Transfer started -- check Protocol Log for live details");

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
      chunk: 1024,
      delay: 0,
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
        {toast && <div className="demo-toast">{toast}</div>}

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

  const activeObjData = OBJECTIVES.find((o) => o.id === activeObj);

  return (
    <div className="demo-tab">
      {toast && <div className="demo-toast">{toast}</div>}

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
        {running && !result && (
          <div className="transfer-progress card">
            <div className="progress-header">
              <span className="progress-label">
                {activeObjData ? activeObjData.label : "Transferring..."}
              </span>
              <span className="progress-count">{chunks.length} chunks</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" />
            </div>
            <p className="progress-hint">
              Watch the Protocol Log for live frame-by-frame details
            </p>
          </div>
        )}
        {activeObj === "O4" && result && compareResult ? (
          <div className="compare-cards">
            <ResultCard
              result={result}
              objective={OBJECTIVES.find((o) => o.id === "O4")}
              label="Run 1: Checksum"
              chunks={firstRunChunks}
              onOpenCalculator={onOpenCalculator}
            />
            <ResultCard
              result={compareResult}
              objective={OBJECTIVES.find((o) => o.id === "O4")}
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
