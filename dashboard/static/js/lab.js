// Numerical Lab: renders the step-by-step solutions that numericals.py computes (nothing is calculated here).
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const FORMS = {
  checksum: {
    hint: "Data can be text (HELLO), hex (0x4865) or binary (1011 0011). It is split into words, added with end-around carry, and complemented.",
    extra: `<label>Word size <select id="lab-word"><option value="8">8-bit (textbook)</option><option value="16">16-bit (our protocol)</option></select></label>`,
    tryLive: "swap",
  },
  crc: {
    hint: "Binary long division by the generator polynomial. Choose a small textbook generator, or CRC-32 (the one in our protocol).",
    extra: `<label>Generator <select id="lab-gen">
        <option value="crc3">CRC-3 · 1011 (x³ + x + 1)</option><option value="crc4">CRC-4 · 10011 (x⁴ + x + 1)</option>
        <option value="crc8">CRC-8 · 100000111</option><option value="crc32">CRC-32 (real protocol)</option>
        <option value="custom">custom…</option></select></label>
      <label id="lab-custom-wrap" hidden>Custom generator (binary) <input id="lab-custom" value="110101" spellcheck="false"></label>`,
    tryLive: "noise",
  },
  hamming: {
    hint: "Hamming(7,4) is what the protocol uses (4 data bits). “General” solves any number of data bits, e.g. 8 bits → Hamming(12,8).",
    extra: `<label>Scheme <select id="lab-scheme"><option value="74">Hamming(7,4) — 4 data bits</option><option value="general">General — any length</option></select></label>
      <label>Parity <select id="lab-parity"><option value="even">even</option><option value="odd">odd</option></select></label>`,
    tryLive: "fec",
  },
};

export function initLab(api) {
  const S = { kind: "checksum", flips: [], swap: null, sol: null, reveal: 1, built: false };

  // ---------------------------------------------------------------- form
  function buildForm() {
    const f = FORMS[S.kind];
    $("#lab-form").innerHTML = `
      <div class="lab-row">
        <label class="grow">Data <input id="lab-input" type="text" spellcheck="false" autocomplete="off" placeholder="HELLO · 0x4865 · 1011 0011"></label>
        <label>Input type <select id="lab-mode"><option value="auto">auto-detect</option><option value="text">text</option>
          <option value="hex">hex</option><option value="bin">binary</option></select></label>
        ${f.extra}
      </div>
      <div class="btn-row">
        <button class="primary" id="lab-solve">Solve</button>
        <button class="ghost-btn" id="lab-textbook">Textbook example</button>
        <button class="ghost-btn" id="lab-random">Random example</button>
        ${S.kind === "checksum" ? '<button class="ghost-btn" id="lab-swap">Swap two words</button>' : ""}
        <button class="ghost-btn" id="lab-clear">Clear flipped bits</button>
      </div>
      <p class="hint" id="lab-hint">${f.hint}</p>`;
    $("#lab-solve").onclick = () => solve(false);
    $("#lab-textbook").onclick = () => example("textbook");
    $("#lab-random").onclick = () => example("random");
    $("#lab-clear").onclick = () => { S.flips = []; S.swap = null; syncSwap(); solve(true); };
    $("#lab-input").addEventListener("keydown", (e) => { if (e.key === "Enter") solve(false); });
    if (S.kind === "checksum") $("#lab-swap").onclick = () => { S.swap = S.swap ? null : "auto"; syncSwap(); solve(true); };
    if (S.kind === "crc") $("#lab-gen").onchange = () => { $("#lab-custom-wrap").hidden = $("#lab-gen").value !== "custom"; };
  }
  function syncSwap() {
    const b = $("#lab-swap");
    if (b) { b.classList.toggle("on", !!S.swap); b.textContent = S.swap ? "Words swapped ✓ (click to undo)" : "Swap two words"; }
  }
  function readParams() {
    const p = { input: $("#lab-input").value, mode: $("#lab-mode").value };
    if (S.kind === "checksum") p.word = +$("#lab-word").value;
    if (S.kind === "crc") p.generator = $("#lab-gen").value === "custom" ? $("#lab-custom").value.trim() : $("#lab-gen").value;
    if (S.kind === "hamming") { p.scheme = $("#lab-scheme").value; p.parity = $("#lab-parity").value; }
    return p;
  }
  function writeParams(p) {
    $("#lab-input").value = p.input ?? "";
    $("#lab-mode").value = p.mode ?? "auto";
    if (S.kind === "checksum" && p.word) $("#lab-word").value = p.word;
    if (S.kind === "crc" && p.generator) {
      const known = ["crc3", "crc4", "crc8", "crc32"].includes(p.generator);
      $("#lab-gen").value = known ? p.generator : "custom";
      $("#lab-custom-wrap").hidden = known;
      if (!known) $("#lab-custom").value = p.generator;
    }
    if (S.kind === "hamming") { $("#lab-scheme").value = p.scheme || "74"; $("#lab-parity").value = p.parity || "even"; }
  }
  async function example(which) {
    const r = await fetch(`/api/numerical/example?kind=${S.kind}&which=${which}&seed=${Math.floor(Math.random() * 1e6)}`).then((x) => x.json());
    S.flips = []; S.swap = null; syncSwap();
    writeParams(r.params);
    solve(false);
  }

  // ---------------------------------------------------------------- solving
  async function solve(keepAll) {
    const params = { kind: S.kind, ...readParams(), flips: S.flips, swap: S.swap };
    const r = await fetch("/api/numerical", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params) }).then((x) => x.json()).catch(() => ({ ok: false, error: "server not reachable" }));
    const hint = $("#lab-hint");
    if (!r.ok) { hint.textContent = "⚠ " + r.error; hint.classList.add("err"); return; }
    hint.classList.remove("err");
    hint.textContent = FORMS[S.kind].hint;
    S.sol = r.solution;
    S.flips = r.solution.flips;
    const total = r.solution.sender.length + r.solution.receiver.length;
    S.reveal = keepAll || S.flips.length || S.swap ? total : 1;
    render();
  }

  // ---------------------------------------------------------------- rendering
  function rowHtml(r) {
    const hl = new Map(r.hl.map(([i, c]) => [i, c]));
    let bits = "";
    for (let i = 0; i < r.bits.length; i++) {
      const c = esc(r.bits[i]), h = hl.get(i);
      bits += h ? `<i class="h-${h}">${c}</i>` : c;
    }
    return `<div class="lrow ${r.cls || ""}"><span class="lbl">${esc(r.label)}</span><span class="bits">${" ".repeat(r.indent)}${bits}</span>${r.note ? `<span class="note">${esc(r.note)}</span>` : ""}</div>`;
  }
  function blockHtml(rows) {
    const lw = Math.max(0, ...rows.map((r) => r.label.length));
    return `<div class="lblock" style="--lw:${lw}ch">${rows.map(rowHtml).join("")}</div>`;
  }
  function stepsHtml(steps, latestIdx) {
    const out = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      let j = i + 1, rows = [...s.rows];
      while (s.group && j < steps.length && steps[j].group === s.group) { rows = rows.concat(steps[j].rows); j++; }
      const latest = latestIdx >= i && latestIdx < j;
      const body = blockHtml(rows);
      out.push(`<article class="lstep ${latest ? "latest" : ""}"><h4><span>${out.length + 1}</span>${esc(s.title)}</h4>
        ${s.text ? `<p>${esc(s.text)}</p>` : ""}
        ${s.collapsed ? `<details><summary>Show the long division (${j - i - 1} steps)</summary>${body}</details>` : body}</article>`);
      i = j - 1;
    }
    return out.join("");
  }
  function strip(sol) {
    const segAt = (i) => sol.segments.find((g) => i >= g.start && i < g.end)?.name || "data";
    const SEGCLS = { data: "seg-data", checksum: "seg-sum", CRC: "seg-crc", P: "seg-par", D: "seg-data" };
    const word = sol.extra.word || 0;
    const flipped = new Set(sol.flips);
    const cells = [...sol.received].map((b, i) => {
      const gap = (word && i && i % word === 0) || (sol.kind === "crc" && i === sol.segments[1]?.start) ? " gap" : "";
      const label = sol.kind === "hamming" ? `<small>${segAt(i)}${i + 1}</small>` : `<small>${i}</small>`;
      return `<button class="bit ${SEGCLS[segAt(i)]}${flipped.has(i) ? " flipped" : ""}${gap}" data-i="${i}" title="click to flip bit ${i}${flipped.has(i) ? " (currently flipped)" : ""}">${b}${label}</button>`;
    });
    const legend = sol.kind === "hamming" ? '<span class="seg-par">parity</span><span class="seg-data">data</span>'
      : sol.kind === "crc" ? '<span class="seg-data">data</span><span class="seg-crc">CRC</span>' : '<span class="seg-data">data words</span><span class="seg-sum">checksum</span>';
    return `<div class="strip-head"><b>Channel</b> — click any bit to flip it in transit <span class="legend">${legend}<span class="flipped">flipped</span></span></div>
      <div class="bits-strip">${cells.join("")}</div>`;
  }
  function chips(sol) {
    const e = sol.extra, out = [];
    const chip = (ok, t) => out.push(`<span class="pchip ${ok ? "ok" : "bad"}">${ok ? "✔" : "✘"} ${t}</span>`);
    if (sol.kind === "checksum" && e.matches_protocol !== undefined) chip(e.matches_protocol, "equals <code>protocol.internet_checksum16</code>");
    if (sol.kind === "crc" && e.matches_zlib !== undefined) chip(e.matches_zlib && e.matches_protocol, "equals <code>zlib.crc32</code> and <code>protocol.crc32</code>");
    if (sol.kind === "crc" && e.bitwise_agrees !== undefined) chip(e.bitwise_agrees, "long division equals the shift-register CRC");
    if (sol.kind === "hamming" && e.matches_protocol !== undefined) chip(e.matches_protocol, "codeword equals <code>protocol.hamming74_encode_nibble</code>");
    if (sol.kind === "hamming" && e.protocol_decode) chip(e.protocol_decode.agrees, "protocol decoder gives the same position &amp; data");
    return out.join("") || "";
  }
  function verdictHtml(sol) {
    const v = sol.verdict, e = sol.extra;
    const cls = { accept: "ok", corrected: "fix", reject: "bad", miscorrected: "bad", undetected: "warn" }[v.status];
    let extra = "";
    if (e.crc_compare) {
      const c = e.crc_compare;
      extra = `<table class="kv cmp"><tr><th>Checksum says</th><td>${c.checksum_detects ? "error detected ✔" : "<b>accepted</b> — error NOT detected ✘"}</td></tr>
        <tr><th>CRC-32 of the same data</th><td>sent <code>${c.sent_crc32}</code> · received <code>${c.received_crc32}</code> → ${c.crc_detects ? "<b>error detected ✔</b>" : "same"}</td></tr></table>`;
    }
    if (sol.kind === "hamming" && v.status === "miscorrected") extra += `<p class="muted">That is why the protocol still runs a CRC / checksum <em>after</em> Hamming: it catches this wrong correction and asks for a resend.</p>`;
    return `<div class="vbanner ${cls}"><b>${esc(v.text)}</b></div>${extra}`;
  }

  function render() {
    const sol = S.sol;
    const nS = sol.sender.length, total = nS + sol.receiver.length;
    $("#lab-work").hidden = false;
    $("#lab-proof").innerHTML = chips(sol);
    $("#lab-channel").innerHTML = strip(sol);
    $$("#lab-channel .bit").forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.i;
      S.flips = S.flips.includes(i) ? S.flips.filter((x) => x !== i) : [...S.flips, i];
      solve(true);
    }));
    const vs = S.reveal >= total;
    $("#lab-verdict").hidden = !vs;
    $("#lab-verdict").innerHTML = vs ? verdictHtml(sol) : "";
    const sSteps = sol.sender.slice(0, Math.min(S.reveal, nS));
    const rSteps = sol.receiver.slice(0, Math.max(0, S.reveal - nS));
    $("#lab-sender .steps").innerHTML = stepsHtml(sSteps, S.reveal <= nS ? S.reveal - 1 : -1);
    $("#lab-receiver .steps").innerHTML = rSteps.length ? stepsHtml(rSteps, S.reveal - nS - 1)
      : `<p class="muted pad">The receiver's working appears after the sender's ${nS} steps. Or click a bit above to send it through a faulty channel.</p>`;
    $("#lab-counter").textContent = `Step ${Math.min(S.reveal, total)} of ${total}`;
    $("#lab-prev").disabled = S.reveal <= 1;
    $("#lab-next").disabled = S.reveal >= total;
    $("#lab-doc").href = "/docs/" + sol.doc.replace(/^docs\//, "");
    $("#lab-work").dataset.kind = sol.kind;
    document.querySelector(".lstep.latest")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  $("#lab-next").addEventListener("click", () => { S.reveal++; render(); });
  $("#lab-prev").addEventListener("click", () => { S.reveal = Math.max(1, S.reveal - 1); render(); });
  $("#lab-all").addEventListener("click", () => { S.reveal = S.sol.sender.length + S.sol.receiver.length; render(); });
  $("#lab-demo").addEventListener("click", () => api.runPreset(FORMS[S.kind].tryLive));
  $$("#lab-kinds button").forEach((b) => b.addEventListener("click", () => setKind(b.dataset.kind)));

  function setKind(k, params) {
    S.kind = k; S.flips = []; S.swap = null; S.sol = null;
    $$("#lab-kinds button").forEach((b) => b.classList.toggle("on", b.dataset.kind === k));
    const special = k === "compare" || k === "practice";
    $("#lab-form").hidden = special;
    $("#lab-work").hidden = true;
    $("#lab-compare").hidden = k !== "compare";
    $("#lab-practice").hidden = k !== "practice";
    if (k === "compare") return openCompare();
    if (k === "practice") return openPractice();
    buildForm();
    if (params) { writeParams(params); solve(false); } else example("textbook");
  }

  // ---------------------------------------------------------------- compare: same data, same damage, every mechanism
  const C = { scenario: "none", flips: [], built: false, last: null };
  const SCEN = [["none", "No error"], ["1bit", "Flip 1 bit"], ["2bit_same", "Flip 2 bits (same block)"],
    ["2bit_far", "Flip 2 bits (far apart)"], ["swap", "Swap two words"]];
  const STATUS = {
    ok: ["ok", "accepted"], corrected: ["fix", "repaired by itself"], detected: ["det", "detected → re-send"],
    undetected: ["bad", "WRONG data accepted"], miscorrected: ["bad", "WRONG 'fix' accepted"],
  };
  function openCompare() {
    if (!C.built) {
      C.built = true;
      $("#cmp-scen").innerHTML = SCEN.map(([k, t]) => `<button class="ghost-btn" data-s="${k}">${t}</button>`).join("");
      $$("#cmp-scen button").forEach((b) => b.addEventListener("click", () => { C.scenario = b.dataset.s; C.flips = []; runCompare(); }));
      $("#cmp-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { C.flips = []; runCompare(); } });
      $("#cmp-input").addEventListener("change", () => { C.flips = []; runCompare(); });
      $("#cmp-mode").addEventListener("change", () => { C.flips = []; runCompare(); });
    }
    runCompare();
  }
  async function runCompare() {
    const body = { input: $("#cmp-input").value, mode: $("#cmp-mode").value, scenario: C.scenario, flips: C.flips };
    const r = await fetch("/api/numerical/compare", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false, error: "server not reachable" }));
    if (!r.ok) { $("#cmp-lesson").className = "vbanner bad"; $("#cmp-lesson").textContent = "⚠ " + r.error; return; }
    C.last = r.result;
    renderCompare(r.result);
  }
  function renderCompare(r) {
    $$("#cmp-scen button").forEach((b) => b.classList.toggle("on", b.dataset.s === r.scenario));
    const flipped = new Set(r.flips);
    const swapped = new Set();
    if (r.swap) r.swap.forEach((w) => { for (let i = w * r.word; i < (w + 1) * r.word; i++) swapped.add(i); });
    $("#cmp-data").innerHTML = `<div class="strip-head"><b>Data as received</b> — ${r.scenario_name}${r.scenario === "custom" ? "" : " · click a bit to flip it yourself"}
      <span class="legend"><span class="flipped">flipped</span><span class="swapped">swapped word</span></span></div>
      <div class="bits-strip">${[...r.received_bits].map((b, i) =>
        `<button class="bit seg-data${flipped.has(i) ? " flipped" : ""}${swapped.has(i) ? " swapped" : ""}${i && i % r.word === 0 ? " gap" : ""}" data-i="${i}" title="click to flip bit ${i}">${b}<small>${i}</small></button>`).join("")}</div>`;
    $$("#cmp-data .bit").forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.i;
      const cur = C.scenario === "custom" ? C.flips : (C.last?.flips || []);
      C.flips = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i];
      C.scenario = "custom";
      runCompare();
    }));
    const worst = r.rows.some((x) => !x.safe);
    $("#cmp-lesson").className = "vbanner " + (r.changed ? (worst ? "warn" : "ok") : "ok");
    $("#cmp-lesson").textContent = r.lesson;
    $("#cmp-table").innerHTML = `<thead><tr><th>Mechanism</th><th>Noticed an error?</th><th>Outcome</th><th>Details</th></tr></thead><tbody>${
      r.rows.map((x) => { const [cls, txt] = STATUS[x.status]; return `<tr class="${x.safe ? "" : "unsafe"}">
        <td><b>${esc(x.name)}</b></td><td>${r.changed ? (x.noticed ? "✅ yes" : "❌ no") : "—"}</td>
        <td><span class="vchip s-${cls}">${x.safe ? "" : "⚠ "}${esc(x.verdict || txt)}</span></td><td class="muted">${esc(x.detail)}</td></tr>`; }).join("")}</tbody>`;
  }

  // ---------------------------------------------------------------- practice: exam-style questions
  const PR = { kind: "checksum", q: null, right: 0, total: 0, built: false };
  async function openPractice() {
    if (!PR.built) {
      PR.built = true;
      const kinds = await fetch("/api/practice/new?kind=checksum").then((x) => x.json());
      $("#prac-kind").innerHTML = Object.entries(kinds.kinds).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join("");
      $("#prac-kind").addEventListener("change", () => { PR.kind = $("#prac-kind").value; newQuestion(); });
      $("#prac-next").addEventListener("click", newQuestion);
      $("#prac-check").addEventListener("click", checkAnswer);
      $("#prac-answer").addEventListener("keydown", (e) => { if (e.key === "Enter") checkAnswer(); });
    }
    newQuestion();
  }
  async function newQuestion() {
    const r = await fetch(`/api/practice/new?kind=${PR.kind}&seed=${Math.floor(Math.random() * 1e9)}`).then((x) => x.json());
    PR.q = r.question;
    $("#prac-prompt").textContent = r.question.prompt;
    $("#prac-format").textContent = `(${r.question.format})`;
    $("#prac-answer").value = ""; $("#prac-answer").focus();
    $("#prac-feedback").hidden = true; $("#prac-work").hidden = true;
    $("#prac-check").disabled = false;
  }
  async function checkAnswer() {
    if (!PR.q || $("#prac-check").disabled) return;
    const r = await fetch("/api/practice/check", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: PR.q, answer: $("#prac-answer").value }) }).then((x) => x.json());
    if (!r.ok) return;
    $("#prac-check").disabled = true;
    PR.total++; if (r.correct) PR.right++;
    $("#prac-score").textContent = `Score ${PR.right} / ${PR.total}`;
    const fb = $("#prac-feedback");
    fb.hidden = false;
    fb.className = "vbanner " + (r.correct ? "ok" : "bad");
    fb.innerHTML = r.correct ? "✔ Correct!" : `✘ Not quite — the answer is <b class="mono">${esc(r.expected)}</b>. Here is the full working:`;
    const steps = ["checksum", "crc", "hamming_encode"].includes(r.kind) ? r.solution.sender : r.solution.receiver;
    $("#prac-work").innerHTML = stepsHtml(steps, -1);
    $("#prac-work").hidden = false;
    if (r.correct) $("#prac-work").insertAdjacentHTML("afterbegin", `<p class="muted pad">Working, for comparison:</p>`);
  }

  // ---------------------------------------------------------------- export (printable page)
  $("#lab-export").addEventListener("click", () => {
    if (!S.sol) return;
    const sol = S.sol;
    const all = (steps) => stepsHtml(steps, -1);
    const w = window.open("", "_blank");
    if (!w) { api.toast("warning", "Pop-up blocked", "Allow pop-ups for this page to export the solution."); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(sol.title)}</title><style>
      body{font:14px/1.5 Segoe UI,system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#111}
      h1{font-size:22px;border-bottom:2px solid #0ea5b7;padding-bottom:6px}h3{margin:22px 0 6px;border-bottom:1px solid #ccc}
      .lstep{margin:10px 0;break-inside:avoid}.lstep h4{margin:0 0 2px;font-size:14px}.lstep h4 span{display:inline-block;background:#0ea5b7;color:#fff;
      border-radius:50%;width:20px;height:20px;text-align:center;margin-right:6px;font-size:12px}.lstep p{margin:2px 0 4px;color:#444}
      .lblock{background:#f4f6f8;border:1px solid #d5dbe1;border-radius:6px;padding:6px 10px;font:13px Consolas,monospace;overflow:auto}
      .lrow{display:flex;gap:12px}.lbl{min-width:calc(var(--lw) * 1ch);color:#555}.bits{white-space:pre}.note{color:#777}
      i{font-style:normal;background:#ffe08a;font-weight:700}.h-carry,.h-bad{background:#ffb4b4}.h-result{background:#b8f0c8}
      .vb{margin:14px 0;padding:10px;border:2px solid #0ea5b7;border-radius:6px;font-weight:700}
      </style></head><body><h1>${esc(sol.title)}</h1>
      <p>Data: <code>${esc(sol.params.input)}</code> · transmitted: <code>${sol.transmitted}</code>${sol.flips.length ? ` · received: <code>${sol.received}</code> (bits flipped: ${sol.flips.join(", ")})` : ""}</p>
      <h3>Sender</h3>${all(sol.sender)}<h3>Receiver</h3>${all(sol.receiver)}
      <div class="vb">${esc(sol.verdict.text)}</div><p style="color:#888">Generated by SecureTransfer Numerical Lab — every number is computed by numericals.py and verified against protocol.py / zlib.</p>
      <script>window.onload=()=>setTimeout(()=>print(),200)<\/script></body></html>`);
    w.document.close();
  });

  return {
    activate() { if (!S.built) { S.built = true; setKind("checksum"); } },
    open(kind, params) { S.built = true; setKind(kind, params); },
  };
}
