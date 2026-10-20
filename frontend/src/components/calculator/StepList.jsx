export default function StepList({ steps, label }) {
  if (!steps || steps.length === 0) return null;
  const visible = steps.filter(
    (s) => (s.text && s.text.length > 0) || (s.rows && s.rows.length > 0)
  );
  if (visible.length === 0) return null;

  return (
    <div className="step-section">
      <h4 className="step-section-label">{label}</h4>
      <ol className="step-list">
        {visible.map((step, i) => (
          <li className="step-item" key={i}>
            <StepCard step={step} index={i} />
          </li>
        ))}
      </ol>
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
    <div className={`step-card ${isResult ? "step-card-result" : ""}`}>
      <div className="step-card-header">
        <span className="step-card-num">{index + 1}</span>
        <span className="step-card-title">{title}</span>
      </div>
      {hasText && <p className="step-card-text">{step.text}</p>}
      {hasRows && (
        <div className="step-card-rows">
          {step.rows.map((row, j) => (
            <StepRow key={j} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ row }) {
  const bits = row.bits || "";
  const isSeparator = /^-+$/.test(bits.trim());
  const isFormula = bits.includes("=") || bits.includes("→") || bits.includes("⊕");
  const isTable = row.label && (row.label === "position" || row.label === "role" ||
    row.label === "covered" || row.label === "bit" || row.label === "codeword" || row.label === "sent");

  if (isSeparator) {
    return <div className="step-row-sep" />;
  }

  if (isTable) {
    const cells = bits.trim().split(/\s{2,}|\s+/);
    return (
      <div className="step-table-row">
        {row.label && <span className="step-table-label">{row.label}</span>}
        <div className="step-table-cells">
          {cells.map((c, i) => (
            <span key={i} className={`step-table-cell ${
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
      <div className="step-formula">
        <code>{bits}</code>
      </div>
    );
  }

  return (
    <div className="step-row" style={row.indent ? { paddingLeft: row.indent * 8 } : undefined}>
      {row.label && <span className="step-row-label">{row.label}</span>}
      <span className={`step-row-bits ${row.cls === "gen" ? "gen" : ""}`}>
        {bits}
      </span>
      {row.note && <span className="step-row-note">{row.note}</span>}
    </div>
  );
}
