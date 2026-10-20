import "./Header.css";

export default function Header({ status }) {
  const online = status === "connected";
  const statusText = online ? "System ready" : "Server offline: run python run_all.py";

  return (
    <header className="header">
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
