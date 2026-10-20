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
      <div className="graphs-grid">
        <div className="card">
          <h3>Throughput vs error rate</h3>
          <NoiseChart data={results?.["bench_noise.csv"]} />
        </div>
        <div className="card">
          <h3>Detection rate: checksum vs CRC32</h3>
          <DetectionChart data={results?.["bench_detection.csv"]} />
        </div>
        <div className="card">
          <h3>Throughput vs added latency</h3>
          <LineChart
            data={results?.["bench_latency.csv"]}
            xKey="added_latency_ms"
            yKey="throughput_kbps"
            label="Throughput"
            color="#22d3ee"
            xLabel="Added latency (ms)"
            yLabel="Throughput (KB/s)"
          />
        </div>
        <div className="card">
          <h3>Throughput vs frame loss</h3>
          <LineChart
            data={results?.["bench_loss.csv"]}
            xKey="frame_loss_pct"
            yKey="throughput_kbps"
            label="Throughput"
            color="#f59e0b"
            xLabel="Frame loss (%)"
            yLabel="Throughput (KB/s)"
          />
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
            borderColor: "#22d3ee",
            backgroundColor: "#22d3ee20",
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
            backgroundColor: "rgba(34,211,238,0.6)",
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

function LineChart({ data, xKey, yKey, label, color, xLabel, yLabel }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: data.map((r) => r[xKey]),
        datasets: [
          {
            label,
            data: data.map((r) => parseFloat(r[yKey])),
            borderColor: color,
            backgroundColor: color + "20",
            tension: 0.3,
            pointRadius: 4,
          },
        ],
      },
      options: makeOptions(xLabel, yLabel),
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data, xKey, yKey, label, color, xLabel, yLabel]);

  if (!data) return <NoData />;
  return <canvas ref={canvasRef} height="200" />;
}

function NoData() {
  return (
    <p className="muted" style={{ fontSize: "0.85rem", padding: "20px 0" }}>
      Run <code>python bench.py</code> to generate data.
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
