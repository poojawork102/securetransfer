import "./ObjectiveStepper.css";

export default function ObjectiveStepper({ objectives, completed, active, running, onRun }) {
  return (
    <div className="stepper card">
      <h3>Objectives</h3>
      <ol className="stepper-list">
        {objectives.map((obj) => (
          <li key={obj.id} className={`stepper-item ${active === obj.id ? "active" : ""}`}>
            <button
              className="stepper-btn"
              disabled={running}
              onClick={() => onRun(obj.id)}
              aria-label={`${obj.id}: ${obj.label}`}
            >
              <span className="stepper-status">
                {completed[obj.id] === true && (
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-label="passed">
                    <circle cx="8" cy="8" r="7" fill="none" stroke="var(--green)" strokeWidth="1.5" />
                    <polyline points="5,8 7,10.5 11,5.5" fill="none" stroke="var(--green)" strokeWidth="1.5" />
                  </svg>
                )}
                {completed[obj.id] === false && (
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-label="failed">
                    <circle cx="8" cy="8" r="7" fill="none" stroke="var(--red)" strokeWidth="1.5" />
                    <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" stroke="var(--red)" strokeWidth="1.5" />
                    <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" stroke="var(--red)" strokeWidth="1.5" />
                  </svg>
                )}
                {completed[obj.id] === undefined && (
                  <span className="stepper-num">{obj.key}</span>
                )}
              </span>
              <span className="stepper-text">
                <span className="stepper-label">{obj.label}</span>
                <span className="stepper-detail">{obj.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
