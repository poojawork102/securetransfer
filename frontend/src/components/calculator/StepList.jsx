export default function StepList({ steps, label }) {
  if (!steps || steps.length === 0) return null;
  const visible = steps.filter(
    (s) => (s.text && s.text.length > 0) || (s.rows && s.rows.length > 0)
  );
  if (visible.length === 0) return null;

  return (
    <div className="flow-section">
      <h4 className="flow-label">{label}</h4>
      <div className="flow-track">
        {visible.map((step, i) => (
          <div className="flow-item" key={i}>
            {i > 0 && (
              <div className="flow-arrow-h">
                <svg width="24" height="20" viewBox="0 0 24 20">
                  <path d="M0 10 L18 10 M14 5 L20 10 L14 15" stroke="var(--accent)" strokeWidth="1.5" fill="none" opacity="0.35" />
                </svg>
              </div>
            )}
            <StepCard step={step} index={i} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StepCard({ step, index }) {
  const title = step.title || `Step ${index + 1}`;
  const hasText = step.text && step.text.length > 0;
  const hasRows = step.rows && step.rows.length > 0;

  const isResult = title.toLowerCase().includes("codeword") ||
    title.toLowerCase().includes("remainder") ||
    title.toLowerCase().includes("checksum") ||
    title.toLowerCase().includes("result");

  return (
    <div className={`flow-card ${isResult ? "flow-card-result" : ""}`}>
      <div className="flow-card-header">
        <span className="flow-card-num">{index + 1}</span>
        <span className="flow-card-title">{title}</span>
      </div>
      {hasText && <p className="flow-card-text">{step.text}</p>}
      {hasRows && (
        <div className="flow-card-rows">
          {step.rows.map((row, j) => (
            <FlowRow key={j} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function FlowRow({ row }) {
  const bits = row.bits || "";
  const isSeparator = /^-+$/.test(bits.trim());
  const isFormula = bits.includes("=") || bits.includes("→") || bits.includes("⊕");
  const isTable = row.label && (row.label === "position" || row.label === "role" ||
    row.label === "covered" || row.label === "bit" || row.label === "codeword" || row.label === "sent");

  if (isSeparator) {
    return <div className="flow-row-sep" />;
  }

  if (isTable) {
    const cells = bits.trim().split(/\s{2,}|\s+/);
    return (
      <div className="flow-table-row">
        {row.label && <span className="flow-table-label">{row.label}</span>}
        <div className="flow-table-cells">
          {cells.map((c, i) => (
            <span key={i} className={`flow-table-cell ${
              c.startsWith("P") ? "cell-parity" :
              c.startsWith("D") ? "cell-data" :
              c === "•" ? "cell-dot" : ""
            }`}>{c}</span>
          ))}
        </div>
      </div>
    );
  }

  if (isFormula) {
    return (
      <div className="flow-formula">
        <code>{bits}</code>
      </div>
    );
  }

  return (
    <div className="flow-row" style={row.indent ? { paddingLeft: row.indent * 8 } : undefined}>
      {row.label && <span className="flow-row-label">{row.label}</span>}
      <span className={`flow-row-bits ${row.cls === "gen" ? "gen" : ""}`}>
        {bits}
      </span>
      {row.note && <span className="flow-row-note">{row.note}</span>}
    </div>
  );
}
