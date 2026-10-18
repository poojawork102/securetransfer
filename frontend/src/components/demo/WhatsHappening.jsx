import "./WhatsHappening.css";

export default function WhatsHappening({ items }) {
  if (items.length === 0) return null;

  return (
    <div className="happening card">
      <h3>What is happening</h3>
      <ul className="happening-list">
        {items.map((item, i) => (
          <li key={i} className={`happening-item ${item.type}`}>
            {item.text}
            {item.count > 1 && (
              <span className="happening-count">+{item.count - 1} more like this</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
