import { useState, useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { getResults, getSession, clearSession } from "../../utils/api";
import "./ResultsTab.css";

export default function ResultsTab() {
  const [results, setResults] = useState(null);
  const [session, setSession] = useState([]);

  useEffect(() => {
    getResults().then(setResults).catch(() => {});
    getSession().then(setSession).catch(() => {});
  }, []);

  return (
    <div className="results-tab">
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 8px" }}>How these results are generated</h3>
        <p className="muted" style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>
          These charts come from <code>bench.py</code>, which runs real file transfers through
          the full protocol stack (client, proxy, server) on localhost. It sends a 128 KB test
          file multiple times under varying error rates and corruption patterns, then measures
          throughput, retransmissions, and detection rates. Each data point is averaged over 3
          runs. The proxy injects the same faults (bit flips, word swaps) used in the live demo,
          so the numbers reflect actual protocol behavior, not a simulation.
        </p>
      </div>
      <div className="graphs-grid">
        <div className="card">
          <h3>Throughput vs error rate</h3>
          <NoiseChart data={results?.["bench_noise.csv"]} />
        </div>
        <div className="card">
          <h3>Detection rate: checksum vs CRC32</h3>
          <DetectionChart data={results?.["bench_detection.csv"]} />
        </div>
      </div>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Session runs</h3>
          <button
            className="btn-clear"
            onClick={() => clearSession().then(() => setSession([]))}
          >
            Clear
          </button>
        </div>
        {session.length === 0 ? (
          <p className="muted" style={{ fontSize: "0.85rem" }}>No transfers yet. Run an objective from the Demo tab.</p>
        ) : (
          <div className="session-scroll">
            <table className="session-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Time</th>
                  <th>File</th>
                  <th>Protection</th>
                  <th>Retransmits</th>
                  <th>Bits fixed</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {session.map((r, i) => (
                  <tr key={i}>
                    <td>{r.n}</td>
                    <td>{r.time}</td>
                    <td>{r.file}</td>
                    <td>{r.protection}</td>
                    <td>{r.retransmits}</td>
                    <td>{r.bits_fixed}</td>
                    <td>
                      <span className={`chip ${r.ok ? "green" : "red"}`}>
                        {r.ok ? "Verified" : "Failed"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function NoiseChart({ data }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const arqRows = data.filter((r) => r.scheme === "Checksum + ARQ" || r.scheme === "CRC+ARQ");
    const fecRows = data.filter((r) => r.scheme === "Hamming FEC");
    const labels = arqRows.map((r) => r.error_rate_pct + "%");

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Checksum + ARQ",
            data: arqRows.map((r) => parseFloat(r.throughput_kbps)),
            borderColor: "#4c8dff",
            backgroundColor: "#4c8dff20",
            tension: 0.3,
            pointRadius: 4,
          },
          {
            label: "Hamming FEC",
            data: fecRows.map((r) => parseFloat(r.throughput_kbps)),
            borderColor: "#3b82f6",
            backgroundColor: "#3b82f620",
            tension: 0.3,
            pointRadius: 4,
          },
        ],
      },
      options: makeOptions("Error rate", "Throughput (KB/s)"),
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data]);

  if (!data) return <NoData />;
  return <canvas ref={canvasRef} height="200" />;
}

function DetectionChart({ data }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    chartRef.current = new Chart(canvasRef.current, {
      type: "bar",
      data: {
        labels: data.map((r) => r.error_pattern),
        datasets: [
          {
            label: "Checksum",
            data: data.map((r) => parseFloat(r.checksum16_pct)),
            backgroundColor: "rgba(245,158,11,0.6)",
          },
          {
            label: "CRC32",
            data: data.map((r) => parseFloat(r.crc32_pct)),
            backgroundColor: "rgba(76,141,255,0.6)",
          },
        ],
      },
      options: makeOptions("Error pattern", "Detection rate (%)"),
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data]);

  if (!data) return <NoData />;
  return <canvas ref={canvasRef} height="200" />;
}

function NoData() {
  return (
    <p className="muted" style={{ fontSize: "0.85rem", padding: "20px 0" }}>
      No data yet. Restart with <code>python run_all.py</code> to generate benchmarks automatically, or run <code>python bench.py</code> manually.
    </p>
  );
}

function makeOptions(xLabel, yLabel) {
  const muted = getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim() || "#6b7280";
  const grid = getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#d1d5db";
  return {
    responsive: true,
    plugins: {
      legend: { labels: { color: muted, font: { size: 11 } } },
    },
    scales: {
      x: {
        title: { display: true, text: xLabel, color: muted },
        ticks: { color: muted, maxRotation: 30 },
        grid: { color: grid + "80" },
      },
      y: {
        title: { display: true, text: yLabel, color: muted },
        ticks: { color: muted },
        grid: { color: grid + "80" },
        beginAtZero: true,
      },
    },
  };
}
