import { Stage } from "./scene.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const ARRIVE_MS = 900; // matches packet travel time in the 3D scene, so the grid flips when the packet lands

// ------------------------------------------------------------------ 3D stage
const stage = new Stage($("#stage"), { client: $("#lbl-client"), proxy: $("#lbl-proxy"), server: $("#lbl-server") });

// ------------------------------------------------------------------ charts
Chart.defaults.color = "#8193b2";
Chart.defaults.borderColor = "rgba(148,163,184,.10)";
Chart.defaults.font.family = getComputedStyle(document.body).getPropertyValue("--mono");
const mkChart = (el, color, fill) => new Chart(el, {
  type: "line",
  data: { labels: [], datasets: [{ data: [], borderColor: color, backgroundColor: fill, fill: true, tension: .35,
    pointRadius: 0, borderWidth: 2 }] },
  options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
    scales: { x: { ticks: { maxTicksLimit: 8 }, title: { display: true, text: "chunk #" } },
              y: { beginAtZero: true, ticks: { maxTicksLimit: 6 } } } },
});
const tputChart = mkChart($("#c-tput"), "#22d3ee", "rgba(34,211,238,.10)");
const rttChart = mkChart($("#c-rtt"), "#c084fc", "rgba(192,132,252,.10)");
let chartsDirty = false;
(function chartLoop() {
  if (chartsDirty) { tputChart.update("none"); rttChart.update("none"); chartsDirty = false; }
  requestAnimationFrame(chartLoop);
})();

// ------------------------------------------------------------------ helpers
function logLine(cls, text) {
  const box = $("#log");
  const d = document.createElement("div");
  d.innerHTML = `<span class="t">${new Date().toLocaleTimeString()}</span> <span class="${cls}">${text}</span>`;
  box.appendChild(d);
  while (box.children.length > 300) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
function setStat(id, v) {
  const el = $(id);
  if (el.textContent === String(v)) return;
  el.textContent = v;
  el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
}
const fmtBytes = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? (n / 1024).toFixed(1) + " KB" : n + " B";

// ------------------------------------------------------------------ run state
let run = null;
function newRun(ev) {
  run = { total: ev.chunks, hmac: ev.hmac, fec: ev.fec, cells: [], lastProxy: {}, hadFail: {}, rtx: 0, fixed: 0,
    blocked: 0, slipped: 0, acked: 0, rtts: [], win: [] };
  const grid = $("#grid");
  grid.innerHTML = "";
  grid.style.setProperty("--cell", ev.chunks > 600 ? "9px" : ev.chunks > 250 ? "12px" : "18px");
  const frag = document.createDocumentFragment();
  for (let i = 0; i < ev.chunks; i++) {
    const c = document.createElement("div");
    c.className = "cell";
    c.title = `chunk ${i}`;
    frag.appendChild(c);
    run.cells.push(c);
  }
  grid.appendChild(frag);
  for (const ch of [tputChart, rttChart]) { ch.data.labels = []; ch.data.datasets[0].data = []; }
  chartsDirty = true;
  stage.reset();
  ["#s-rtx", "#s-fixed"].forEach((id) => setStat(id, 0));
  setStat("#s-forge", "0 / 0");
  setStat("#s-chunks", `0/${ev.chunks}`);
  $("#s-bar").style.width = "0%";
  $("#verdict").classList.remove("show");
  $("#sec-badge").textContent = [ev.fec ? "Hamming FEC" : null, "CRC32", ev.hmac ? "HMAC-SHA256" : null].filter(Boolean).join(" + ");
  $("#sec-badge").className = "badge " + (ev.hmac ? "secure" : "ghost");
}
function paint(seq, cls, extra) {
  const c = run?.cells[seq];
  if (!c) return;
  c.className = "cell " + cls + (extra ? " " + extra : "");
  void c.offsetWidth;
  if (cls !== "sending") c.classList.add("flip");
}

// ------------------------------------------------------------------ liveness
const lastSeen = { client: 0, proxy: 0, server: 0 };
setInterval(() => {
  const now = Date.now();
  for (const k of Object.keys(lastSeen)) {
    const on = now - lastSeen[k] < 4000;
    $("#pill-" + k).classList.toggle("on", on);
    stage.setAlive(k, on || k === "client");
  }
}, 500);

// ------------------------------------------------------------------ channel UI
let channel = { mode: "clean", rate: 0.1, bits: 1, delay_ms: 0, loss: 0 };
function renderChannel(st) {
  const b = $("#channel-badge");
  b.className = "badge " + (st.mode !== "clean" ? st.mode : "");
  let txt = `CHANNEL: ${st.mode.toUpperCase()}`;
  if (st.mode !== "clean") txt += ` · ${Math.round(st.rate * 100)}%`;
  if (st.mode === "noise") txt += ` · ${st.bits}-bit`;
  if (st.delay_ms) txt += ` · +${st.delay_ms}ms`;
  if (st.loss) txt += ` · loss ${Math.round(st.loss * 100)}%`;
  b.textContent = txt;
  $("#lbl-proxy-mode").textContent = st.mode === "attack" ? "MITM attacker" : st.mode === "noise" ? "noisy link" : "clean link";
  if (stage.mode !== st.mode) stage.setMode(st.mode);
}
function readChannelUI() {
  return {
    mode: $("#mode .on").dataset.mode,
    rate: +$("#rate").value / 100,
    bits: +$("#bits").value,
    delay_ms: +$("#lat").value,
    loss: +$("#loss").value / 100,
  };
}
let pushTimer;
function pushChannel(now = false) {
  channel = readChannelUI();
  renderChannel(channel);
  $("#bits-wrap").style.opacity = channel.mode === "noise" ? 1 : .35;
  clearTimeout(pushTimer);
  const send = () => fetch("/api/proxy", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(channel) });
  return now ? send() : (pushTimer = setTimeout(send, 150));
}
$$("#mode button").forEach((b) => b.addEventListener("click", () => {
  $$("#mode button").forEach((x) => x.classList.toggle("on", x === b));
  pushChannel();
}));
const sliders = { rate: (v) => v + "%", bits: (v) => v, lat: (v) => v + " ms", loss: (v) => v + "%", delay: (v) => v + " ms" };
for (const [id, fmt] of Object.entries(sliders)) {
  const el = $("#" + id), out = $(`#${id === "lat" ? "lat" : id}-out`);
  const upd = () => { out.textContent = fmt(el.value); if (id !== "delay") pushChannel(); };
  el.addEventListener("input", upd);
  out.textContent = fmt(el.value);
}

function setBusy(b) {
  $("#send").classList.toggle("busy", b);
  $(".presets").classList.toggle("busy", b);
}

// ------------------------------------------------------------------ file + send
fetch("/api/samples").then((r) => r.json()).then((list) => {
  $("#sample").innerHTML = list.map((f) => `<option value="${f.name}"${f.name === "sample.txt" ? " selected" : ""}>${f.name} (${fmtBytes(f.size)})</option>`).join("");
});
$("#upload").addEventListener("change", (e) => {
  const f = e.target.files[0];
  $("#upload-name").textContent = f ? `${f.name} (${fmtBytes(f.size)}) — click to change` : "or upload your own file…";
});

async function startTransfer() {
  if ($("#send").classList.contains("busy")) return;
  await pushChannel(true);
  const fd = new FormData();
  const f = $("#upload").files[0];
  if (f) fd.append("file", f);
  fd.append("opts", JSON.stringify({
    sample: $("#sample").value, chunk: +$("#chunk").value, delay: +$("#delay").value,
    hmac: $("#hmac").checked, fec: $("#fec").checked,
    timeout: channel.loss ? 0.6 : 2.0,
  }));
  setBusy(true);
  const r = await fetch("/api/send", { method: "POST", body: fd }).then((x) => x.json()).catch((e) => ({ ok: false, error: String(e) }));
  if (!r.ok) { setBusy(false); logLine("bad", `✘ ${r.error}`); }
}
$("#send").addEventListener("click", startTransfer);

const PRESETS = {
  clean:  { mode: "clean",  fec: false, hmac: false, rate: 10, bits: 1 },
  noise:  { mode: "noise",  fec: false, hmac: false, rate: 15, bits: 1 },
  fec:    { mode: "noise",  fec: true,  hmac: false, rate: 15, bits: 1 },
  attack: { mode: "attack", fec: false, hmac: false, rate: 10, bits: 1 },
  hmac:   { mode: "attack", fec: false, hmac: true,  rate: 10, bits: 1 },
};
$$(".presets button").forEach((b) => b.addEventListener("click", () => {
  if ($("#send").classList.contains("busy")) return;
  const p = PRESETS[b.dataset.preset];
  $$("#mode button").forEach((x) => x.classList.toggle("on", x.dataset.mode === p.mode));
  $("#fec").checked = p.fec; $("#hmac").checked = p.hmac;
  $("#rate").value = p.rate; $("#bits").value = p.bits; $("#lat").value = 0; $("#loss").value = 0;
  Object.keys(sliders).forEach((id) => $("#" + id).dispatchEvent(new Event("input")));
  startTransfer();
}));
$("#clear-log").addEventListener("click", () => ($("#log").innerHTML = ""));
$("#verdict-close").addEventListener("click", () => $("#verdict").classList.remove("show"));
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  const k = { 1: "clean", 2: "noise", 3: "fec", 4: "attack", 5: "hmac" }[e.key];
  if (k) $(`.presets [data-preset=${k}]`).click();
});

// ------------------------------------------------------------------ verdict
function showVerdict(kind, title, text, hash) {
  const v = $("#verdict");
  v.className = "verdict " + kind;
  $("#verdict-icon").textContent = kind === "bad" ? "✘" : kind === "shield" ? "⛨" : "✓";
  $("#verdict-title").textContent = title;
  $("#verdict-text").textContent = text;
  $("#verdict-hash").textContent = hash || "";
  requestAnimationFrame(() => v.classList.add("show"));
}

// ------------------------------------------------------------------ telemetry
const socket = io();
socket.on("connect", () => { $("#pill-socket").classList.add("on"); logLine("dash", "dashboard connected"); });
socket.on("disconnect", () => $("#pill-socket").classList.remove("on"));

socket.on("telemetry", (ev) => {
  lastSeen[ev.src] = Date.now();
  const key = `${ev.src}:${ev.ev}`;

  switch (key) {
    case "proxy:heartbeat":
    case "proxy:mode":
      renderChannel(ev);
      if (key === "proxy:mode") logLine("proxy", `channel → ${ev.mode.toUpperCase()}`);
      break;

    case "client:start":
      newRun(ev);
      setBusy(true);
      logLine("client", `▶ sending ${ev.file} (${fmtBytes(ev.size)}, ${ev.chunks} chunks × ${ev.chunk_size} B)`);
      break;

    case "client:send":
      if (!run) break;
      stage.sendPacket(ev.seq, ev.attempt);
      if (ev.attempt === 1) paint(ev.seq, "sending");
      break;

    case "proxy:pass":
      stage.proxyEvent(ev.seq, "pass");
      if (run) run.lastProxy[ev.seq] = "pass";
      break;
    case "proxy:corrupt":
      stage.proxyEvent(ev.seq, "corrupt");
      if (run) run.lastProxy[ev.seq] = "corrupt";
      logLine("bad", `⚡ proxy flipped ${ev.bits} bit(s) in chunk ${ev.seq}`);
      break;
    case "proxy:forge":
      stage.proxyEvent(ev.seq, "forge");
      if (run) run.lastProxy[ev.seq] = "forge";
      logLine("forge", `☠ MITM rewrote chunk ${ev.seq} and recomputed its CRC32`);
      break;
    case "proxy:drop":
      stage.proxyEvent(ev.seq, "drop");
      if (run) { run.hadFail[ev.seq] = true; paint(ev.seq, "dropped"); }
      logLine("proxy", `✂ chunk ${ev.seq} dropped in transit`);
      break;

    case "server:chunk": {
      if (!run) break;
      stage.serverResult(ev.seq, ev.status);
      const seq = ev.seq, forged = run.lastProxy[seq] === "forge";
      if (ev.status === "crc_fail") { run.hadFail[seq] = true; logLine("bad", `✘ chunk ${seq}: CRC mismatch → NACK`); }
      if (ev.status === "hmac_fail") {
        run.hadFail[seq] = true; run.wasHmac = run.wasHmac || {}; run.wasHmac[seq] = true; run.blocked++;
        logLine("forge", `⛨ chunk ${seq}: CRC passed but HMAC failed → forged data rejected`);
      }
      if (ev.status === "corrected") { run.fixed += ev.fixed; logLine("fix", `✚ chunk ${seq}: Hamming corrected ${ev.fixed} bit(s)`); }
      if ((ev.status === "ok" || ev.status === "corrected") && forged) {
        run.slipped++;
        logLine("bad", `⚠ chunk ${seq}: forged data ACCEPTED — CRC was fooled`);
      }
      const cls = ev.status === "crc_fail" ? "crc" : ev.status === "hmac_fail" ? "hmac"
        : forged ? "fooled" : ev.status === "corrected" ? "corrected" : run.hadFail[seq] ? "resent" : "ok";
      const extra = run.wasHmac?.[seq] && cls !== "hmac" ? "was-hmac" : "";
      const r = run;
      setTimeout(() => {
        if (r !== run) return;
        paint(seq, cls, extra);
        setStat("#s-fixed", r.fixed);
        setStat("#s-forge", `${r.blocked} / ${r.slipped}`);
      }, ARRIVE_MS);
      break;
    }

    case "client:nack":
      if (!run) break;
      run.rtx++; setStat("#s-rtx", run.rtx);
      break;
    case "client:timeout":
      if (!run) break;
      run.rtx++; setStat("#s-rtx", run.rtx);
      logLine("proxy", `⏱ chunk ${ev.seq}: no ACK (timeout) → retransmit`);
      break;
    case "client:ack":
      if (!run) break;
      run.rtts.push(ev.rtt_ms);
      rttChart.data.labels.push(ev.seq);
      rttChart.data.datasets[0].data.push(ev.rtt_ms);
      chartsDirty = true;
      break;
    case "client:progress":
      if (!run) break;
      run.acked = ev.seq + 1;
      setStat("#s-chunks", `${run.acked}/${run.total}`);
      $("#s-bar").style.width = (run.acked / run.total * 100) + "%";
      // throughput over a sliding window of the last 10 chunks (avoids the huge spike at chunk 0)
      run.win.push([ev.t, ev.done]);
      if (run.win.length > 11) run.win.shift();
      if (run.win.length > 1) {
        const [t0, b0] = run.win[0], [t1, b1] = run.win[run.win.length - 1];
        const kbps = (b1 - b0) / 1024 / Math.max(t1 - t0, 1e-6);
        setStat("#s-tput", Math.round(kbps));
        tputChart.data.labels.push(ev.seq);
        tputChart.data.datasets[0].data.push(+kbps.toFixed(1));
      }
      chartsDirty = true;
      if (run.rtts.length) {
        const a = run.rtts, avg = a.reduce((s, x) => s + x, 0) / a.length;
        setStat("#s-rtt", avg.toFixed(2));
      }
      break;

    case "server:result":
      if (run) run.result = ev;
      break;

    case "client:done": {
      setBusy(false);
      if (!run) break;
      setStat("#s-tput", Math.round(ev.throughput_kbps));
      setStat("#s-rtt", ev.avg_rtt_ms.toFixed(2));
      $("#s-jit").textContent = `ms · ±${ev.jitter_ms.toFixed(2)}`;
      const r = run;
      logLine(ev.verified ? "server" : "bad",
        `■ done in ${ev.elapsed_s}s · ${ev.throughput_kbps} KB/s · ${ev.retransmits} retransmits · overhead ${ev.overhead_pct}%`);
      setTimeout(() => {
        const hash = r.result ? `expected ${r.result.expected.slice(0, 24)}…  got ${r.result.got.slice(0, 24)}…` : "";
        if (!ev.verified) {
          showVerdict("bad", "FILE TAMPERED",
            `CRC32 accepted all ${r.total} chunks, but ${r.slipped} were forged by the attacker. SHA-256 of the received file does not match. Turn on HMAC.`, hash);
        } else if (r.blocked) {
          showVerdict("shield", "ATTACK BLOCKED",
            `HMAC-SHA256 rejected ${r.blocked} forged chunk(s); they were retransmitted. File verified.`, hash);
        } else if (r.fixed) {
          showVerdict("", "VERIFIED · SELF-HEALED",
            `Hamming(7,4) silently corrected ${r.fixed} flipped bit(s) — ${ev.retransmits} retransmits needed.`, hash);
        } else {
          showVerdict("", "VERIFIED",
            `${r.total} chunks · ${ev.retransmits} retransmitted · SHA-256 of received file matches.`, hash);
        }
      }, ARRIVE_MS + 200);
      break;
    }

    case "client:error":
      setBusy(false);
      logLine("bad", `✘ ${ev.msg}`);
      showVerdict("bad", "TRANSFER FAILED", ev.msg + " — is the server/proxy running?");
      break;

    case "server:aborted":
      logLine("bad", `server: connection dropped, partial file kept (${ev.received} chunks)`);
      break;
  }
});

renderChannel(channel);
pushChannel();
