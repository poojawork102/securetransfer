import { Stage } from "./scene.js";
import { toast, setSound } from "./toast.js";
import "./glossary.js";
import { initDemo } from "./demo.js";
import { initLab } from "./lab.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const ARRIVE_MS = 900; // matches packet travel time in the 3D scene, so the grid flips when the packet lands
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const fmtBytes = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? (n / 1024).toFixed(1) + " KB" : n + " B";

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
  d.innerHTML = `<span class="t">${new Date().toLocaleTimeString()}</span> <span class="${cls}">${esc(text)}</span>`;
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

// ------------------------------------------------------------------ views & tabs
function setView(v) {
  document.body.classList.toggle("simple", v === "simple");
  document.body.classList.toggle("advanced", v === "advanced");
  $$("#view-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  store.set("st_view", v);
  setTimeout(() => stage.resize?.(), 50);
}
$$("#view-toggle button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
setView(store.get("st_view", "simple"));

function showTab(t) {
  $$(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  $("#tab-transfer").hidden = t !== "transfer";
  $("#tab-lab").hidden = t !== "lab";
  if (t === "transfer") setTimeout(() => stage.resize?.(), 30);
  if (t === "lab") lab.activate();
}
$$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

// ------------------------------------------------------------------ run state (one transfer = 1..2 attempts)
let run = null;   // visual state of the current attempt
let tx = null;    // state across attempts of one transfer
let lastResult = null;
const waiters = [];
const telemetryListeners = new Set();

function resetTransfer() {
  tx = { attempt: 1, decisions: [], quarantined: [], slipped: 0, label: ui.label, intrusion: false };
  $("#timeline").innerHTML = '<li class="empty">Nothing yet — Auto Defense is watching.</li>';
  $("#attempt-badge").hidden = true;
  setChip("#chip-channel", "trusted", "");
}

function newRun(ev) {
  run = { total: ev.chunks, cells: [], info: {}, lastProxy: {}, hadFail: {}, rtx: 0, fixed: 0, blocked: 0, slipped: 0,
    acked: 0, rtts: [], win: [], wasHmac: {} };
  const grid = $("#grid");
  grid.innerHTML = "";
  grid.style.setProperty("--cell", ev.chunks > 600 ? "9px" : ev.chunks > 250 ? "12px" : "18px");
  ensureCells(ev.chunks);
  for (const ch of [tputChart, rttChart]) { ch.data.labels = []; ch.data.datasets[0].data = []; }
  chartsDirty = true;
  stage.reset();
  ["#s-rtx", "#s-fixed"].forEach((id) => setStat(id, 0));
  setStat("#s-forge", "0 / 0");
  setStat("#s-chunks", `0/${ev.chunks}`);
  $("#s-bar").style.width = "0%";
  $("#def-progress-text").textContent = `sending 0 / ~${ev.chunks} chunks`;
  $("#verdict").classList.remove("show");
  $("#s-tput-label").textContent = ui.delay > 0 ? "Throughput (demo-paced)" : "Throughput";
  $("#c-tput-title").textContent = ui.delay > 0 ? "Throughput (KB/s, demo-paced)" : "Throughput (KB/s)";
}
function ensureCells(n) {
  if (!run) return;
  const grid = $("#grid"), frag = document.createDocumentFragment();
  while (run.cells.length < n) {
    const c = document.createElement("div");
    c.className = "cell";
    c.dataset.i = run.cells.length;
    c.title = `chunk ${run.cells.length} — click to inspect`;
    frag.appendChild(c);
    run.cells.push(c);
  }
  grid.appendChild(frag);
}
function paint(seq, cls, extra) {
  if (!run) return;
  ensureCells(seq + 1);
  const c = run.cells[seq];
  c.className = "cell " + cls + (extra ? " " + extra : "");
  void c.offsetWidth;
  if (cls !== "sending") c.classList.add("flip");
}
const info = (seq) => (run.info[seq] = run.info[seq] || { nacks: [] });

// ------------------------------------------------------------------ protection strip + timeline
function setChip(sel, text, state) {
  const el = $(sel);
  el.querySelector("b").textContent = text;
  el.dataset.state = state || "";
}
function setDefense(p) {
  if (p.auto !== undefined) setChip("#chip-auto", p.auto ? "ON" : "OFF", p.auto ? "on" : "");
  if (p.fec !== undefined) setChip("#chip-fec", p.fec ? "ON" : "off", p.fec ? "on" : "");
  if (p.hmac !== undefined) setChip("#chip-hmac", p.hmac ? "ON" : "off", p.hmac ? "secure" : "");
  if (p.check) setChip("#chip-check", p.check === "checksum16" ? "Checksum-16" : "CRC32", "");
  if (p.chunk_size) setChip("#chip-chunk", p.chunk_size + " B", "");
  if (p.fec !== undefined || p.hmac !== undefined) {
    $("#sec-badge").textContent = [p.fec ? "Hamming" : null, p.check === "checksum16" ? "Checksum-16" : "CRC32",
      p.hmac ? "HMAC-SHA256" : null].filter(Boolean).join(" + ");
    $("#sec-badge").className = "badge " + (p.hmac ? "secure" : "ghost");
  }
}
const ACTION_ICON = { fec_on: "✚", fec_off: "−", halve_chunk: "÷2", intrusion_alert: "⛨", give_up: "✕", retry_with_hmac: "↻" };
function addTimeline(ev) {
  const ol = $("#timeline");
  ol.querySelector(".empty")?.remove();
  const li = document.createElement("li");
  li.className = ev.action;
  li.innerHTML = `<span class="tl-ico">${ACTION_ICON[ev.action] || "•"}</span><div><b>${ev.seq != null ? `chunk ${ev.seq}` : "end of file"}${tx.attempt > 1 ? ` · attempt ${tx.attempt}` : ""}</b><p>${esc(ev.reason)}</p></div>`;
  ol.appendChild(li);
  ol.scrollTop = ol.scrollHeight;
}

// ------------------------------------------------------------------ health: liveness, banner, send button
const lastSeen = { client: 0, proxy: 0, server: 0 };
const comps = {
  server: { on: false, name: "Server", cmd: "python server.py", why: "Nothing is there to receive the file." },
  proxy: { on: false, name: "Network (proxy)", cmd: "python proxy.py", why: "The file has no path to travel on." },
};
let healthKnown = false;
let busy = false;
function updateBanner() {
  const off = Object.values(comps).filter((c) => !c.on);
  const b = $("#banner");
  b.hidden = !off.length || !healthKnown;
  if (!off.length) return;
  const both = off.length === 2;
  $("#banner-title").textContent = both ? "Server and network are offline." : `${off[0].name} is offline.`;
  $("#banner-text").textContent = `${both ? "Nothing can be sent." : off[0].why} Open a terminal in the project folder and run:`;
  $("#banner-cmd").textContent = both ? "python run_all.py" : off[0].cmd;
}
function updateSend() {
  const ok = comps.server.on && comps.proxy.on;
  const btn = $("#send");
  btn.disabled = !ok;
  btn.classList.toggle("busy", busy);
  const note = $("#send-note");
  note.hidden = ok;
  if (!ok) note.textContent = "Sending is disabled until the server and network are online (see the red banner).";
}
function setOnline(name, on) {
  const c = comps[name];
  if (healthKnown && c.on === on) return;
  const was = c.on, first = !healthKnown;
  c.on = on;
  if (!first || !on) {
    if (on) toast("success", `${c.name} is online`, was === false && !first ? "Back in business." : "Ready.", { key: "online-" + name });
    else toast("danger", `${c.name} is offline`, c.why, { hint: c.cmd, key: "offline-" + name });
  }
  updateBanner(); updateSend();
}
function setBusy(b) {
  busy = b;
  $(".presets").classList.toggle("busy", b);
  $("#scenarios").classList.toggle("locked", b);
  updateSend();
}
setInterval(() => {
  const now = Date.now();
  for (const k of Object.keys(lastSeen)) {
    const on = now - lastSeen[k] < 4000;
    $("#pill-" + k).classList.toggle("on", k === "client" ? on : on);
    stage.setAlive(k, on || k === "client");
    if (k !== "client" && healthKnown) setOnline(k, on);
  }
}, 500);
fetch("/api/health").then((r) => r.json()).then((h) => {
  const now = Date.now();
  if (h.server) lastSeen.server = now;
  if (h.proxy) lastSeen.proxy = now;
  comps.server.on = h.server; comps.proxy.on = h.proxy;
  healthKnown = true;
  for (const k of ["server", "proxy"]) if (!comps[k].on) toast("danger", `${comps[k].name} is offline`, comps[k].why, { hint: comps[k].cmd, key: "offline-" + k });
  updateBanner(); updateSend();
  if (h.proxy_state?.mode) syncFromProxy(h.proxy_state);
}).catch(() => { healthKnown = true; updateBanner(); });

// ------------------------------------------------------------------ channel (proxy) UI
let channel = { mode: "clean", rate: 0.1, bits: 1, delay_ms: 0, loss: 0, pattern: "random" };
let proxySynced = false;
function renderChannel(st) {
  const b = $("#channel-badge");
  b.className = "badge " + (st.mode !== "clean" ? st.mode : "");
  let txt = `NETWORK: ${st.mode === "attack" ? "HACKER" : st.mode === "noise" ? "NOISY" : "CLEAN"}`;
  if (st.mode !== "clean") txt += ` · ${Math.round(st.rate * 100)}%`;
  if (st.mode === "noise") txt += st.pattern === "swap" ? " · word swap" : ` · ${st.bits}-bit`;
  if (st.delay_ms) txt += ` · +${st.delay_ms}ms`;
  if (st.loss) txt += ` · loss ${Math.round(st.loss * 100)}%`;
  b.textContent = txt;
  $("#lbl-proxy-mode").textContent = st.mode === "attack" ? "MITM hacker" : st.mode === "noise" ? "noisy link" : "clean link";
  if (stage.mode !== st.mode) stage.setMode(st.mode);
  const scn = st.mode;
  $$("#scenarios button").forEach((x) => x.classList.toggle("on", x.dataset.scn === scn));
}
function readChannelUI() {
  return {
    mode: $("#mode .on").dataset.mode,
    rate: +$("#rate").value / 100,
    bits: +$("#bits").value,
    delay_ms: +$("#lat").value,
    loss: +$("#loss").value / 100,
    pattern: $("#pattern .on").dataset.pattern,
  };
}
function writeChannelUI(st) {
  $$("#mode button").forEach((x) => x.classList.toggle("on", x.dataset.mode === st.mode));
  $$("#pattern button").forEach((x) => x.classList.toggle("on", x.dataset.pattern === (st.pattern || "random")));
  $("#rate").value = Math.round(st.rate * 100); $("#bits").value = st.bits;
  $("#lat").value = st.delay_ms; $("#loss").value = Math.round(st.loss * 100);
  Object.keys(sliders).forEach((id) => { $("#" + id + "-out").textContent = sliders[id]($("#" + id).value); });
  $("#bits-wrap").style.opacity = st.mode === "noise" && st.pattern !== "swap" ? 1 : .35;
}
// the page must never silently reset the proxy: on load we READ its state from the heartbeat
function syncFromProxy(st) {
  channel = { ...channel, ...st };
  writeChannelUI(channel);
  renderChannel(channel);
  proxySynced = true;
}
let pushTimer;
function pushChannel(now = false) {
  channel = readChannelUI();
  renderChannel(channel);
  $("#bits-wrap").style.opacity = channel.mode === "noise" && channel.pattern !== "swap" ? 1 : .35;
  clearTimeout(pushTimer);
  const send = () => fetch("/api/proxy", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(channel) });
  return now ? send() : (pushTimer = setTimeout(send, 150));
}
$$("#mode button").forEach((b) => b.addEventListener("click", () => {
  $$("#mode button").forEach((x) => x.classList.toggle("on", x === b)); ui.label = null; pushChannel();
}));
$$("#pattern button").forEach((b) => b.addEventListener("click", () => {
  $$("#pattern button").forEach((x) => x.classList.toggle("on", x === b)); ui.label = null; pushChannel();
}));
const sliders = { rate: (v) => v + "%", bits: (v) => v, lat: (v) => v + " ms", loss: (v) => v + "%", delay: (v) => v + " ms" };
for (const [id, fmt] of Object.entries(sliders)) {
  const el = $("#" + id), out = $(`#${id}-out`);
  el.addEventListener("input", () => {
    out.textContent = fmt(el.value);
    if (id === "delay") ui.delay = +el.value; else { ui.label = null; pushChannel(); }
  });
  out.textContent = fmt(el.value);
}

// ------------------------------------------------------------------ options, scenarios, presets
const ui = { label: null, delay: 40 };
const SCENARIOS = {
  clean: { label: "Normal network", ch: { mode: "clean", rate: 0.1, bits: 1, pattern: "random" } },
  noise: { label: "Bad network", ch: { mode: "noise", rate: 0.2, bits: 1, pattern: "random" } },
  attack: { label: "Hacker attack", ch: { mode: "attack", rate: 0.15, bits: 1, pattern: "random" } },
};
function applyConfig(c) {
  if (c.channel) writeChannelUI({ ...readChannelUI(), delay_ms: 0, loss: 0, ...c.channel });
  if (c.fec !== undefined) $("#fec").checked = c.fec;
  if (c.hmac !== undefined) $("#hmac").checked = c.hmac;
  if (c.auto !== undefined) $("#auto").checked = c.auto;
  if (c.check) $("#check").value = c.check;
  if (c.chunk) $("#chunk").value = c.chunk;
  if (c.speed !== undefined) { $("#delay").value = c.speed; $("#delay-out").textContent = c.speed + " ms"; ui.delay = c.speed; }
  if (c.sample) $("#sample").value = c.sample;
  if (c.label !== undefined) ui.label = c.label;
  updateAutoHint();
  channel = readChannelUI();
  renderChannel(channel);
}
function updateAutoHint() {
  $("#auto-hint").textContent = $("#auto").checked
    ? "The sender watches the network and switches protections on and off by itself."
    : "Manual: only the basic per-chunk check (CRC32) is used — see what that can and cannot catch.";
  setDefense({ auto: $("#auto").checked });
}
$("#auto").addEventListener("change", updateAutoHint);
$$("#scenarios button").forEach((b) => b.addEventListener("click", () => {
  if (busy) return;
  const s = SCENARIOS[b.dataset.scn];
  applyConfig({ channel: s.ch, fec: false, hmac: false, check: "crc32", label: s.label });
  pushChannel(true);
}));
$("#fec").addEventListener("change", () => { ui.label = null; });
$("#hmac").addEventListener("change", () => { ui.label = null; });

const PRESETS = {
  clean:  { label: "1 · Clean link", channel: { mode: "clean", rate: 0.1, bits: 1 }, fec: false, hmac: false },
  noise:  { label: "2 · Noisy link (CRC)", channel: { mode: "noise", rate: 0.15, bits: 1 }, fec: false, hmac: false },
  fec:    { label: "3 · Noise + Hamming", channel: { mode: "noise", rate: 0.15, bits: 1 }, fec: true, hmac: false },
  attack: { label: "4 · MITM attack (CRC only)", channel: { mode: "attack", rate: 0.10, bits: 1 }, fec: false, hmac: false },
  hmac:   { label: "5 · Attack + HMAC", channel: { mode: "attack", rate: 0.10, bits: 1 }, fec: false, hmac: true },
};
async function runPreset(name) {
  if (busy) return;
  showTab("transfer");
  if (name === "swap") {
    const base = { channel: { mode: "noise", rate: 0.3, bits: 1, pattern: "swap" }, fec: false, hmac: false, auto: false };
    applyConfig({ ...base, check: "checksum16", label: "6a · Word swap, Checksum-16" });
    await startTransfer();
    await sleep(2500);
    applyConfig({ ...base, check: "crc32", label: "6b · Word swap, CRC32" });
    return startTransfer();
  }
  const p = PRESETS[name];
  applyConfig({ ...p, auto: false, check: "crc32" });
  return startTransfer();
}
$$(".presets button").forEach((b) => b.addEventListener("click", () => runPreset(b.dataset.preset)));
$("#clear-log").addEventListener("click", () => ($("#log").innerHTML = ""));
document.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  if ($("#tab-transfer").hidden) return;
  const k = { 1: "clean", 2: "noise", 3: "fec", 4: "attack", 5: "hmac", 6: "swap" }[e.key];
  if (k) runPreset(k);
  if (e.key === "Escape") { $("#inspector").hidden = true; $("#proof").hidden = true; }
});

function describeChannel() {
  const c = readChannelUI();
  if (c.mode === "clean") return "Clean network";
  if (c.mode === "attack") return `Hacker attack ${Math.round(c.rate * 100)}%`;
  return `Noise ${Math.round(c.rate * 100)}% ${c.pattern === "swap" ? "word swap" : c.bits + "-bit"}`;
}

// ------------------------------------------------------------------ file + send
fetch("/api/samples").then((r) => r.json()).then((list) => {
  $("#sample").innerHTML = list.map((f) => `<option value="${esc(f.name)}"${f.name === "sample.txt" ? " selected" : ""}>${esc(f.name)} (${fmtBytes(f.size)})</option>`).join("");
});
$("#upload").addEventListener("change", (e) => {
  const f = e.target.files[0];
  $("#upload-name").textContent = f ? `${f.name} (${fmtBytes(f.size)}) — click to change` : "or upload your own file…";
});

function startTransfer() {
  return new Promise(async (resolve) => {
    if (busy || !comps.server.on || !comps.proxy.on) {
      if (!comps.server.on || !comps.proxy.on) toast("danger", "Can't send yet", "The server and network must be online first.", { key: "cantsend" });
      return resolve(null);
    }
    await pushChannel(true);
    const auto = $("#auto").checked;
    const fd = new FormData();
    const f = $("#upload").files[0];
    if (f) fd.append("file", f);
    fd.append("opts", JSON.stringify({
      sample: $("#sample").value, chunk: +$("#chunk").value, delay: +$("#delay").value,
      hmac: $("#hmac").checked, fec: $("#fec").checked, auto, check: $("#check").value,
      scenario: ui.label || describeChannel(), timeout: channel.loss ? 0.6 : 2.0,
    }));
    setBusy(true);
    const r = await fetch("/api/send", { method: "POST", body: fd }).then((x) => x.json()).catch((e) => ({ ok: false, error: String(e) }));
    if (!r.ok) {
      setBusy(false);
      toast("danger", "Could not start the transfer", r.error || "unknown error");
      logLine("bad", `✘ ${r.error}`);
      return resolve(null);
    }
    waiters.push(resolve);
  });
}
$("#send").addEventListener("click", () => startTransfer());

function finish(kind, ev) {
  lastResult = { kind, ev, tx, run };
  setBusy(false);
  loadSession();
  while (waiters.length) waiters.shift()(lastResult);
}

// ------------------------------------------------------------------ verdict
function showVerdict(kind, title, text, hash, explain, proof) {
  const v = $("#verdict");
  v.className = "verdict " + kind;
  $("#verdict-icon").textContent = kind === "bad" ? "✘" : kind === "shield" ? "⛨" : kind === "warn" ? "!" : "✓";
  $("#verdict-title").textContent = title;
  $("#verdict-text").textContent = text;
  $("#verdict-hash").textContent = hash || "";
  $("#verdict-explain-text").textContent = explain || "";
  $("#verdict-explain").hidden = !explain;
  $("#verdict-explain").open = false;
  $("#verdict-proof").hidden = !proof;
  requestAnimationFrame(() => v.classList.add("show"));
}
$("#verdict-close").addEventListener("click", () => $("#verdict").classList.remove("show"));
$("#verdict-report").addEventListener("click", () => $("#card-session").scrollIntoView({ behavior: "smooth", block: "center" }));

const sumStat = (ev, k) => (ev.attempts || []).reduce((s, a) => s + (a.server_stats?.[k] || 0), 0);
function buildVerdict(ev) {
  const attempts = (ev.attempts || []).length || 1;
  const blocked = sumStat(ev, "hmac_fail"), fixed = sumStat(ev, "bits_fixed");
  const slipped = tx.slipped + (run?.slipped || 0);
  const fp = ev.final_protection || {};
  const checkName = fp.check === "checksum16" ? "16-bit checksum" : "CRC32";
  const adapted = (ev.decisions || []).filter((d) => ["fec_on", "fec_off", "halve_chunk"].includes(d.action));
  const hash = run?.result ? `expected ${run.result.expected.slice(0, 24)}…  got ${run.result.got.slice(0, 24)}…` : "";
  const facts = `${ev.file}: ${fmtBytes(ev.size)} sent as ${ev.chunks} chunks in ${ev.elapsed_s}s, ${ev.retransmits} chunk(s) sent again.`;
  const sha = "At the end the server compares a SHA-256 fingerprint of everything it received with the original's.";

  if (!ev.verified) {
    const swap = fp.check === "checksum16" && !slipped;
    const title = swap ? "FILE TAMPERED — CHECKSUM FOOLED" : slipped ? "FILE TAMPERED — CRC FOOLED" : "REJECTED · QUARANTINED";
    const why = swap
      ? `Words inside chunks were reordered. A 16-bit checksum only adds the words up, so a reordering doesn't change the total — every chunk passed. CRC32 does notice (try the CRC32 run).`
      : slipped ? `An attacker rewrote ${slipped} chunk(s) and recomputed their CRC32, so each one looked perfect.`
        : "The assembled file did not match the original.";
    return { kind: "bad", title,
      text: `Every chunk passed its ${checkName} check, but the whole-file SHA-256 does not match. The bad file was quarantined — it was NOT saved as received. ${$("#auto").checked ? "" : "Turn on Auto Defense (or HMAC) to stop this."}`,
      hash, proof: !!ev.quarantine_path,
      explain: `${facts} ${why} ${sha} They differ, so the file was moved to quarantine/ with a report of the expected and actual hash. Nothing wrong ever reached the received/ folder.` };
  }
  if (attempts > 1) {
    return { kind: "shield", title: "VERIFIED AFTER AUTO-RECOVERY",
      text: `The first copy was tampered with (it slipped past CRC32), so it was quarantined. Auto Defense re-sent the file with HMAC${blocked ? ` and blocked ${blocked} forged chunk(s)` : ""}. The final file is verified.`,
      hash, proof: !!ev.quarantine_path,
      explain: `${facts} Attempt 1 failed the end-to-end SHA-256 check (all chunks passed CRC32, but ${slipped || "some"} had been rewritten by the attacker), so the file was quarantined. The client then turned on HMAC — a keyed fingerprint the attacker cannot recompute — and sent it again; ${blocked} forged chunk(s) were rejected and re-sent. The second SHA-256 check matched.` };
  }
  if (blocked) {
    return { kind: "shield", title: "ATTACK BLOCKED",
      text: `HMAC-SHA256 rejected ${blocked} forged chunk(s); they were re-sent. File verified.`, hash,
      explain: `${facts} The attacker changed chunk data and recomputed the CRC32, so CRC could not see it. But the HMAC needs a secret key the attacker does not have, so ${blocked} forged chunk(s) failed verification, were NACKed and re-sent unaltered. ${sha} It matched.` };
  }
  if (fixed) {
    return { kind: "", title: "VERIFIED · SELF-HEALED",
      text: `Hamming(7,4) silently corrected ${fixed} flipped bit(s) — ${ev.retransmits} chunk(s) had to be re-sent.`, hash,
      explain: `${facts} Noise flipped single bits. Because Hamming was on, the server located each bad bit from the parity "syndrome" and flipped it back — ${fixed} repair(s) with no resend. Only bursts that broke more than one bit per 7-bit block needed a retransmission (${ev.retransmits}). ${sha} It matched.` };
  }
  if (adapted.length) {
    return { kind: "", title: "VERIFIED · AUTO-ADAPTED",
      text: `Auto Defense changed the protection ${adapted.length} time(s) during the transfer and the file arrived intact.`, hash,
      explain: `${facts} What Auto Defense did: ${adapted.map((d) => d.reason).join("; ")}. ${sha} It matched.` };
  }
  return { kind: "", title: "VERIFIED",
    text: `${ev.chunks} chunks · ${ev.retransmits} re-sent · SHA-256 of the received file matches.`, hash,
    explain: `${facts} ${ev.retransmits ? `Damaged chunks were caught by the ${checkName} check and the server asked for them again (stop-and-wait ARQ).` : "Nothing went wrong on the way."} ${sha} It matched, so the file was saved to received/.` };
}

function failureAdvice(msg) {
  if (/cannot connect|refused/i.test(msg)) return ["The network component isn't reachable.", "Start it with: python proxy.py (or python run_all.py)."];
  if (/Gave up/i.test(msg)) return ["The link was too damaged to get one chunk through. The partial file was quarantined.", "Lower the error rate, or send again with Auto Defense on."];
  if (/connection lost|closed/i.test(msg)) return ["The server or network went away mid-transfer. The partial file was quarantined.", "Restart it (python run_all.py) and send again."];
  return [msg, "Check the server and network are running, then try again."];
}

// ------------------------------------------------------------------ chunk inspector
const FLAGNAMES = [[1, "HMAC"], [2, "FEC"], [4, "CHECKSUM16"]];
function inspectChunk(i) {
  const d = run?.info[i];
  $("#insp-seq").textContent = "#" + i;
  const body = $("#insp-body"), acts = $("#insp-actions");
  if (!d || d.length === undefined) {
    body.innerHTML = '<p class="muted">No data recorded for this chunk yet.</p>';
    acts.innerHTML = "";
    $("#inspector").hidden = false;
    return;
  }
  const flagTxt = FLAGNAMES.filter(([b]) => d.flags & b).map(([, n]) => n).join(" + ") || "none";
  const chk = d.check === "checksum16" ? "Internet checksum (16-bit)" : "CRC32";
  const bits = d.check_value.toString(2).padStart(d.check === "checksum16" ? 16 : 32, "0").replace(/(.{8})/g, "$1 ").trim();
  const rows = [
    ["SEQ", i], ["LEN", `${d.length} bytes (on wire ${d.wire_len})`], ["FILE OFFSET", d.offset],
    ["FLAGS", `0b${d.flags.toString(2).padStart(3, "0")} → ${flagTxt}`],
    [chk.toUpperCase(), `0x${d.check_value.toString(16).padStart(d.check === "checksum16" ? 4 : 8, "0")}`],
    ["", `<code>${bits}</code>`],
    ["FIRST BYTES", `<code>${d.head.replace(/(..)/g, "$1 ").trim()}</code>`],
  ];
  let story = [];
  const p = d.proxy;
  if (p?.kind === "corrupt") {
    if (p.pattern === "swap") story.push(`<b>Network:</b> two 16-bit words (bytes ${p.byte_a}–${p.byte_a + 1} and ${p.byte_b}–${p.byte_b + 1}) were swapped. Their sum is unchanged.`);
    else if (p.syndrome) story.push(`<b>Network:</b> bit ${p.bit} of byte ${p.wire_byte} was flipped in transit.`);
    else story.push(`<b>Network:</b> ${p.bits} bit(s) flipped — first one is bit ${p.bit} of byte ${p.wire_byte ?? p.byte}.`);
  }
  if (p?.kind === "forge") story.push("<b>Hacker:</b> overwrote part of the data with <code>HACKED!!</code> and recomputed the CRC32.");
  if (p?.kind === "drop") story.push("<b>Network:</b> this chunk was dropped (lost).");
  const fx = d.fixes?.[0];
  if (fx) story.push(`<b>Hamming:</b> syndrome <code>${fx.syndrome.toString(2).padStart(3, "0")}₂ = ${fx.syndrome}</code> → bit ${fx.syndrome} of codeword #${fx.codeword} (data byte ${fx.byte}, ${fx.nibble ? "low" : "high"} nibble) corrected.`);
  if (d.status === "crc_fail" || d.status === "checksum_fail") story.push(`<b>Server:</b> ${d.status === "crc_fail" ? "CRC32" : "checksum"} mismatch → NACK → sent again.`);
  if (d.status === "hmac_fail") story.push("<b>Server:</b> CRC matched but the HMAC did not → forgery rejected.");
  if (p?.kind === "forge" && (d.status === "ok" || d.status === "corrected")) story.push("<b>Server:</b> accepted it — the check was fooled.");
  if (!story.length) story.push("<b>Network:</b> passed through untouched.");
  body.innerHTML = `<table class="kv">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>
    <div class="story">${story.map((s) => `<p>${s}</p>`).join("")}</div>`;
  const head = d.head, nib = head ? parseInt(head.slice(0, 1), 16).toString(2).padStart(4, "0") : "1011";
  acts.innerHTML = `<small>Solve this chunk in the Numerical Lab</small>
    <button class="ghost-btn" data-k="checksum">Checksum</button><button class="ghost-btn" data-k="crc">CRC</button><button class="ghost-btn" data-k="hamming">Hamming</button>`;
  acts.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    $("#inspector").hidden = true;
    const k = b.dataset.k;
    const params = k === "checksum" ? { input: "0x" + head, mode: "hex", word: head.length >= 4 ? 16 : 8 }
      : k === "crc" ? { input: "0x" + head.slice(0, 4), mode: "hex", generator: "crc8" }
        : { input: nib, mode: "bin", scheme: "74", parity: "even" };
    showTab("lab");
    lab.open(k, params);
  }));
  $("#inspector").hidden = false;
}
$("#grid").addEventListener("click", (e) => { const c = e.target.closest(".cell"); if (c) inspectChunk(+c.dataset.i); });
$("#inspector-close").addEventListener("click", () => ($("#inspector").hidden = true));

// ------------------------------------------------------------------ proof modal
$("#verdict-proof").addEventListener("click", async () => {
  const r = await fetch("/api/proof").then((x) => x.json()).catch(() => ({ ok: false }));
  const body = $("#proof-body");
  if (!r.ok) { $("#proof-summary").textContent = r.error || "No quarantined file available."; body.innerHTML = ""; }
  else {
    $("#proof-summary").innerHTML = `Comparing the original <b>${esc(r.file)}</b> with the quarantined copy <b>${esc(r.quarantine)}</b>: ` +
      `<b>${r.differing_bytes}</b> byte(s) differ in <b>${r.regions_total}</b> place(s)${r.found_mark ? ` — the attacker's <code>HACKED!!</code> marker is in the file` : ""}.`;
    const cell = (hex, ascii, hs, hl, bad) => {
      const hb = hex.split(" ");
      return `<div class="hex">${hb.map((h, i) => `<span class="${i >= hs && i < hs + hl ? bad : ""}">${h}</span>`).join("")}</div>
        <div class="asc">${[...ascii].map((c, i) => `<span class="${i >= hs && i < hs + hl ? bad : ""}">${esc(c)}</span>`).join("")}</div>`;
    };
    body.innerHTML = r.regions.map((g) => `<div class="diff"><h4>at byte offset ${g.offset} (${g.length} byte${g.length > 1 ? "s" : ""})</h4>
      <div class="side"><b>original</b>${cell(g.orig_hex, g.orig_ascii, g.hit_start, g.hit_len, "ok")}</div>
      <div class="side"><b>received</b>${cell(g.new_hex, g.new_ascii, g.hit_start, g.hit_len, "bad")}</div></div>`).join("")
      + (r.regions_total > r.regions.length ? `<p class="muted">… and ${r.regions_total - r.regions.length} more place(s).</p>` : "");
  }
  $("#proof").hidden = false;
});
$("#proof-close").addEventListener("click", () => ($("#proof").hidden = true));
$("#proof").addEventListener("click", (e) => { if (e.target.id === "proof") $("#proof").hidden = true; });

// ------------------------------------------------------------------ session table
async function loadSession() {
  for (const wait of [350, 1200]) {
    await sleep(wait);
    const rows = await fetch("/api/session").then((r) => r.json()).catch(() => []);
    const tb = $("#session-table tbody");
    if (!rows.length) { tb.innerHTML = '<tr class="empty"><td colspan="7">Run a transfer and it appears here.</td></tr>'; return; }
    tb.innerHTML = rows.slice().reverse().map((r) => `<tr><td>${r.n}</td><td>${esc(r.scenario)}</td><td>${esc(r.protection)}</td>
      <td>${r.retransmits}</td><td>${r.bits_fixed}</td><td>${r.forged_blocked}</td>
      <td><span class="vchip ${r.ok ? (r.attempts > 1 ? "rec" : "ok") : "bad"}">${esc(r.verdict)}</span></td></tr>`).join("");
  }
}
$("#session-clear").addEventListener("click", async () => { await fetch("/api/session/clear", { method: "POST" }); loadSession(); });
loadSession();

// ------------------------------------------------------------------ telemetry
const socket = io();
socket.on("connect", () => { $("#pill-socket").classList.add("on"); logLine("dash", "dashboard connected"); });
socket.on("disconnect", () => $("#pill-socket").classList.remove("on"));

socket.on("telemetry", (ev) => {
  lastSeen[ev.src] = Date.now();
  telemetryListeners.forEach((fn) => fn(ev));
  const key = `${ev.src}:${ev.ev}`;

  switch (key) {
    case "proxy:heartbeat":
      if (!proxySynced) syncFromProxy(ev); else renderChannel(ev);
      break;
    case "proxy:mode":
      renderChannel(ev);
      logLine("proxy", `network → ${ev.mode.toUpperCase()}`);
      break;

    case "client:start":
      if (!tx || ev.attempt === 1) resetTransfer(); else { tx.attempt = ev.attempt; tx.slipped += run?.slipped || 0; }
      newRun(ev);
      setBusy(true);
      setDefense({ auto: ev.auto, fec: ev.fec, hmac: ev.hmac, check: ev.check, chunk_size: ev.chunk_size });
      $("#attempt-badge").hidden = ev.attempt < 2;
      $("#attempt-badge").textContent = "ATTEMPT " + ev.attempt;
      logLine("client", `▶ ${ev.attempt > 1 ? `attempt ${ev.attempt}: ` : ""}sending ${ev.file} (${fmtBytes(ev.size)}, ~${ev.chunks} chunks × ${ev.chunk_size} B)`);
      if (ev.attempt === 1) toast("info", "Transfer started", `Sending ${ev.file} (${fmtBytes(ev.size)})${ev.auto ? " with Auto Defense" : ""}.`, { key: "start" });
      break;

    case "client:send":
      if (!run) break;
      stage.sendPacket(ev.seq, ev.attempt);
      Object.assign(info(ev.seq), { offset: ev.offset, length: ev.length, head: ev.head || "", flags: ev.flags,
        wire_len: ev.wire_len, check_value: ev.check_value, check: ev.check, attempt: ev.attempt });
      if (ev.attempt === 1) paint(ev.seq, "sending");
      break;

    case "proxy:pass":
      stage.proxyEvent(ev.seq, "pass");
      if (run) { run.lastProxy[ev.seq] = "pass"; info(ev.seq).proxy = { kind: "pass" }; }
      break;
    case "proxy:corrupt":
      stage.proxyEvent(ev.seq, "corrupt");
      if (run) { run.lastProxy[ev.seq] = "corrupt"; info(ev.seq).proxy = { kind: "corrupt", ...ev }; }
      logLine("bad", ev.pattern === "swap"
        ? `⚡ network swapped two words in chunk ${ev.seq} (bytes ${ev.byte_a} ↔ ${ev.byte_b})`
        : `⚡ network flipped ${ev.bits} bit(s) in chunk ${ev.seq} (bit ${ev.bit} of byte ${ev.wire_byte ?? ev.byte})`);
      toast("warning", "Network is damaging data", "", { key: "corrupt", merge: (n) => `${n} chunk${n > 1 ? "s" : ""} damaged in transit.` });
      break;
    case "proxy:forge":
      stage.proxyEvent(ev.seq, "forge");
      if (run) { run.lastProxy[ev.seq] = "forge"; info(ev.seq).proxy = { kind: "forge" }; }
      logLine("forge", `☠ hacker rewrote chunk ${ev.seq} and recomputed its CRC32`);
      toast("warning", "Hacker is altering data", "", { key: "forge", merge: (n) => `${n} chunk${n > 1 ? "s" : ""} rewritten on the network.` });
      break;
    case "proxy:drop":
      stage.proxyEvent(ev.seq, "drop");
      if (run) { run.hadFail[ev.seq] = true; paint(ev.seq, "dropped"); info(ev.seq).proxy = { kind: "drop" }; }
      logLine("proxy", `✂ chunk ${ev.seq} dropped in transit`);
      break;

    case "server:chunk": {
      if (!run) break;
      stage.serverResult(ev.seq, ev.status);
      const seq = ev.seq, forged = run.lastProxy[seq] === "forge";
      const inf = info(seq);
      inf.status = ev.status; inf.fixes = ev.fixes?.length ? ev.fixes : inf.fixes;
      if (ev.status === "crc_fail" || ev.status === "checksum_fail") {
        run.hadFail[seq] = true;
        logLine("bad", `✘ chunk ${seq}: ${ev.status === "crc_fail" ? "CRC mismatch" : "checksum mismatch"} → NACK`);
      }
      if (ev.status === "hmac_fail") {
        run.hadFail[seq] = true; run.wasHmac[seq] = true; run.blocked++;
        logLine("forge", `⛨ chunk ${seq}: CRC passed but HMAC failed → forged data rejected`);
      }
      if (ev.status === "corrected") {
        run.fixed += ev.fixed;
        const fx = ev.fixes?.[0];
        logLine("fix", `✚ chunk ${seq}: Hamming corrected ${ev.fixed} bit(s)` + (fx ? ` (syndrome ${fx.syndrome.toString(2).padStart(3, "0")}₂ = ${fx.syndrome})` : ""));
      }
      if ((ev.status === "ok" || ev.status === "corrected") && forged) {
        run.slipped++;
        logLine("bad", `⚠ chunk ${seq}: forged data ACCEPTED — the check was fooled`);
      }
      const cls = ev.status === "crc_fail" || ev.status === "checksum_fail" ? "crc" : ev.status === "hmac_fail" ? "hmac"
        : forged ? "fooled" : ev.status === "corrected" ? "corrected" : run.hadFail[seq] ? "resent" : "ok";
      const extra = run.wasHmac[seq] && cls !== "hmac" ? "was-hmac" : "";
      const r = run;
      setTimeout(() => {
        if (r !== run) return;
        paint(seq, cls, extra);
        setStat("#s-fixed", r.fixed);
        setStat("#s-forge", `${r.blocked} / ${r.slipped}`);
      }, ARRIVE_MS);
      break;
    }

    case "server:quarantine":
      tx?.quarantined.push(ev.path);
      logLine("bad", `🔒 server quarantined ${ev.name} (${ev.reason})`);
      toast("security", "File quarantined", `${ev.name} failed verification (${ev.reason.replace(/_/g, " ")}) and was locked away in the quarantine folder — it was not saved as a good file.`, { key: "quarantine" + Date.now() });
      break;

    case "client:adapt": {
      if (!tx) break;
      tx.decisions.push(ev);
      addTimeline(ev);
      setDefense({ fec: ev.fec, hmac: ev.hmac, chunk_size: ev.chunk_size });
      logLine(ev.action === "intrusion_alert" ? "forge" : "client", `AUTO DEFENSE ▶ ${ev.reason}`);
      if (ev.action === "intrusion_alert") {
        tx.intrusion = true;
        setChip("#chip-channel", "COMPROMISED", "bad");
        toast("security", "INTRUSION ALERT", ev.reason, { key: "intrusion" });
      } else if (ev.action === "give_up") {
        toast("danger", "Auto Defense gave up", ev.reason);
      } else if (ev.action === "retry_with_hmac") {
        toast("warning", "Automatic retry", "Re-sending the whole file with HMAC switched on.", { key: "retry" });
      } else {
        toast("info", "Auto Defense", ev.reason, { ttl: 5500 });
      }
      break;
    }

    case "client:nack":
      if (!run) break;
      run.rtx++; setStat("#s-rtx", run.rtx);
      info(ev.seq).nacks.push(ev.reason);
      break;
    case "client:timeout":
      if (!run) break;
      run.rtx++; setStat("#s-rtx", run.rtx);
      logLine("proxy", `⏱ chunk ${ev.seq}: no ACK (timeout) → retransmit`);
      toast("warning", "Chunks timing out", "", { key: "timeout", merge: (n) => `${n} chunk${n > 1 ? "s" : ""} timed out and were sent again.` });
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
      if (ev.est_total > run.cells.length) ensureCells(ev.est_total);
      run.total = ev.est_total;
      setStat("#s-chunks", `${run.acked}/${run.total}`);
      $("#s-bar").style.width = (ev.done / Math.max(1, ev.total) * 100) + "%";
      $("#def-progress-text").textContent = `${run.acked} / ~${run.total} chunks · ${Math.round(ev.done / Math.max(1, ev.total) * 100)}%`;
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
      if (run.rtts.length) setStat("#s-rtt", (run.rtts.reduce((s, x) => s + x, 0) / run.rtts.length).toFixed(2));
      break;

    case "server:result":
      if (run) run.result = ev;
      break;

    case "client:done": {
      if (!run || !tx) { finish("done", ev); break; }
      while (run.cells.length > ev.chunks && ev.chunks > 0) run.cells.pop().remove();
      setStat("#s-tput", Math.round(ev.throughput_kbps));
      setStat("#s-rtt", ev.avg_rtt_ms.toFixed(2));
      $("#s-jit").textContent = `ms · ±${ev.jitter_ms.toFixed(2)}`;
      $("#def-progress-text").textContent = ev.verified ? "done · verified" : "done · rejected";
      logLine(ev.verified ? "server" : "bad",
        `■ ${ev.verified ? "verified" : "REJECTED"} in ${ev.elapsed_s}s · ${ev.throughput_kbps} KB/s · ${ev.retransmits} retransmits · overhead ${ev.overhead_pct}%`);
      const r = run, t = tx;
      setTimeout(() => {
        const v = buildVerdict(ev);
        showVerdict(v.kind, v.title, v.text, v.hash, v.explain, v.proof);
        if (ev.verified) {
          toast(v.kind === "shield" ? "security" : "success", v.title.charAt(0) + v.title.slice(1).toLowerCase().replace(/\b(crc|sha|hmac)\b/g, (m) => m.toUpperCase()),
            v.kind === "shield" ? v.text : `${ev.file} arrived intact and was saved.`, { ttl: v.kind === "shield" ? 0 : undefined });
        } else {
          toast("danger", "File rejected", `${ev.file} did not match the original, so it was quarantined — not saved.`);
        }
      }, ARRIVE_MS + 200);
      finish("done", ev);
      break;
    }

    case "client:error": {
      logLine("bad", `✘ ${ev.msg}`);
      const [what, next] = failureAdvice(ev.msg);
      showVerdict("bad", "TRANSFER FAILED", `${what} ${next}`, "",
        `The transfer stopped early: ${ev.msg}. ${ev.decisions?.length ? "Auto Defense had taken " + ev.decisions.length + " action(s) first. " : ""}Any partial file was quarantined, so no incomplete file is mistaken for a good one.`, false);
      toast("danger", "Transfer failed", `${what} ${next}`);
      finish("error", ev);
      break;
    }

    case "server:aborted":
      logLine("bad", `server: connection dropped after ${ev.received} chunk(s); partial file quarantined`);
      break;
  }
});

// ------------------------------------------------------------------ welcome, help, sound
function openWelcome() { $("#welcome").hidden = false; $("#welcome-guided").focus(); }
function closeWelcome() { $("#welcome").hidden = true; store.set("st_welcomed", "1"); }
$("#help-btn").addEventListener("click", openWelcome);
$("#welcome-explore").addEventListener("click", closeWelcome);
$("#welcome").addEventListener("click", (e) => { if (e.target.id === "welcome") closeWelcome(); });
$("#sound-toggle").addEventListener("click", (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", on);
  e.currentTarget.textContent = on ? "🔔" : "🔇";
  setSound(on);
  if (on) toast("info", "Sound on", "You'll hear a short tone for warnings and alerts.", { ttl: 2500 });
});

// ------------------------------------------------------------------ wire the modules together
const api = {
  applyConfig, startTransfer, pushChannel, runPreset, showTab, fmtBytes, sleep, toast,
  setChannel: (st) => fetch("/api/proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(st) }),
  onTelemetry: (fn) => { telemetryListeners.add(fn); return () => telemetryListeners.delete(fn); },
  isOnline: () => comps.server.on && comps.proxy.on,
  isBusy: () => busy,
  lastResult: () => lastResult,
  closeWelcome,
};
const lab = initLab(api);
const demo = initDemo(api);
$("#welcome-guided").addEventListener("click", () => { closeWelcome(); demo.startGuided(); });
$("#demo-guided").addEventListener("click", () => demo.startGuided());
$("#demo-full").addEventListener("click", () => demo.startFull());

updateAutoHint();
resetTransfer();
renderChannel(channel);
if (store.get("st_welcomed") !== "1") openWelcome();
