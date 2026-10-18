import "./Header.css";

export default function Header({ status }) {
  const online = status === "connected";
  const statusText = online ? "System ready" : "Server offline: run python run_all.py";

  return (
    <header className="header">
      <svg className="header-bg" viewBox="0 0 1400 88" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="link-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
            <stop offset="50%" stopColor="var(--accent)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        <line x1="200" y1="44" x2="1200" y2="44" stroke="url(#link-grad)" strokeWidth="1.5" />
        <circle cx="200" cy="44" r="6" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        <text x="200" y="66" textAnchor="middle" fill="var(--text-muted)" fontSize="11" fontFamily="var(--font)">Client</text>
        <circle cx="1200" cy="44" r="6" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        <text x="1200" y="66" textAnchor="middle" fill="var(--text-muted)" fontSize="11" fontFamily="var(--font)">Server</text>
        <g className="packets">
          <rect className="pkt pkt-1" x="-6" y="40" width="12" height="8" rx="2" fill="var(--accent)" opacity="0.8" />
          <rect className="pkt pkt-2" x="-6" y="40" width="12" height="8" rx="2" fill="var(--accent)" opacity="0.8" />
          <rect className="pkt pkt-3" x="-6" y="40" width="12" height="8" rx="2" fill="var(--accent)" opacity="0.8" />
        </g>
      </svg>

      <div className="header-content">
        <div className="header-left">
          <svg className="logo" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="8" cy="16" r="5" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
            <circle cx="24" cy="16" r="5" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
            <line x1="13" y1="16" x2="19" y2="16" stroke="var(--accent)" strokeWidth="1.5" />
            <polyline points="21,13 24,16 21,19" fill="none" stroke="var(--green)" strokeWidth="1.5" />
          </svg>
          <h1 className="header-title">SecureTransfer</h1>
        </div>
        <p className="header-subtitle">
          TCP-Based Client-Server File Transfer with Error Verification, CNL Group 4
        </p>
        <div className={`header-status ${online ? "online" : "offline"}`}>
          <span className="status-dot" />
          {statusText}
        </div>
      </div>
    </header>
  );
}
