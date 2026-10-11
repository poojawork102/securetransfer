// Guided demo: a stepper (Step N of 7) where each step shows "What we'll do / What to watch",
// runs a real transfer, then shows "What happened / Why it matters". "Run full demo" plays all 7 back to back
// with on-screen (and optional spoken) narration — this is the faculty demo.
const $ = (s) => document.querySelector(s);
const sum = (ev, k) => (ev.attempts || []).reduce((s, a) => s + (a.server_stats?.[k] || 0), 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

const STEPS = [
  {
    short: "Normal network", title: "A normal network",
    cfg: { channel: { mode: "clean", rate: 0.1, bits: 1, pattern: "random" }, fec: false, hmac: false, auto: true, check: "crc32", speed: 30, sample: "sample.txt" },
    doText: "Send a file over a perfect network, with Auto Defense watching.",
    watch: "Every square in the chunk map turns green. The timeline stays empty — Auto Defense only acts when it sees a problem.",
    happened: (ev) => `All ${ev.chunks} chunks arrived the first time with ${plural(ev.retransmits, "repeat")}. The server's SHA-256 fingerprint of the file matched the original.`,
    matters: "This is the baseline: on a healthy network the protections cost almost nothing, and the final fingerprint is what lets us say “arrived unchanged”.",
  },
  {
    short: "Noise → CRC catches it", title: "A noisy network: CRC catches it, then resend",
    cfg: { channel: { mode: "noise", rate: 0.2, bits: 1, pattern: "random" }, fec: false, hmac: false, auto: false, check: "crc32", speed: 30, sample: "sample.txt" },
    doText: "The network now randomly flips bits in about 1 chunk in 5. Auto Defense is off, so only CRC32 and stop-and-wait resending protect the file.",
    watch: "Red squares are chunks damaged in transit. Each is rejected and sent again — it turns amber once it arrives clean.",
    happened: (ev) => `CRC32 caught ${plural(sum(ev, "crc_fail"), "damaged chunk")}; each was sent again until it arrived clean. The file was verified.`,
    matters: "Detect + resend is the basic recipe of reliable transfer. The price: every error costs a round trip and a repeated chunk.",
  },
  {
    short: "Noise + Hamming", title: "Same noise, but Hamming repairs it itself",
    cfg: { channel: { mode: "noise", rate: 0.2, bits: 1, pattern: "random" }, fec: true, hmac: false, auto: false, check: "crc32", speed: 30, sample: "sample.txt" },
    doText: "Same noisy network, but Hamming(7,4) is on: the sender adds parity bits so the receiver can find and repair a single flipped bit without asking again.",
    watch: "Blue squares are chunks repaired on the spot. The “Bits fixed” counter climbs and the resend count stays near zero.",
    happened: (ev) => `Hamming repaired ${plural(sum(ev, "bits_fixed"), "flipped bit")} with no resend (${plural(ev.retransmits, "resend")} were needed for damage it could not fix).`,
    matters: "Correction trades bandwidth (the file is sent twice as large) for fewer resends — worth it on long or noisy links where a round trip is expensive.",
  },
  {
    short: "Hacker vs CRC", title: "A hacker fools CRC — Auto Defense quarantines and retries",
    cfg: { channel: { mode: "attack", rate: 0.15, bits: 1, pattern: "random" }, fec: false, hmac: false, auto: true, check: "crc32", speed: 30, sample: "sample.txt" },
    doText: "A hacker on the network rewrites some chunks and recomputes their CRC32, so each one looks perfect. Auto Defense is on but starts without HMAC.",
    watch: "Orange squares are forged chunks that CRC accepted. At the end the whole-file fingerprint fails, the file is locked in quarantine, and the client automatically sends it again with HMAC.",
    happened: (ev) => ev.verified && (ev.attempts || []).length > 1
      ? `CRC32 was fooled on attempt 1, but the end-to-end SHA-256 check caught it: the bad copy went to quarantine and the file was re-sent with HMAC, which blocked ${plural(sum(ev, "hmac_fail"), "forged chunk")}. Final result: verified.`
      : ev.verified ? "No forged chunk happened to be hit this time, so the file arrived intact." : "The file was rejected and quarantined.",
    matters: "A checksum or CRC protects against accidents, not against someone who can recompute it. The end-to-end hash plus quarantine means a tampered file is never accepted.",
  },
  {
    short: "Hacker vs HMAC", title: "The same hacker against HMAC — blocked",
    cfg: { channel: { mode: "attack", rate: 0.15, bits: 1, pattern: "random" }, fec: false, hmac: true, auto: false, check: "crc32", speed: 30, sample: "sample.txt" },
    doText: "Same hacker, but every chunk now carries an HMAC — a fingerprint made with a secret key the hacker does not have.",
    watch: "Purple squares are forged chunks, rejected the moment they arrive and re-sent untouched. No quarantine is needed.",
    happened: (ev) => `${plural(sum(ev, "hmac_fail"), "forged chunk")} were rejected on arrival. The file was verified on the first attempt.`,
    matters: "Authentication — not just error detection — is what stops deliberate tampering.",
  },
  {
    short: "Auto Defense", title: "Auto Defense: everything changes mid-transfer",
    cfg: { channel: { mode: "noise", rate: 0.25, bits: 1, pattern: "random" }, fec: false, hmac: false, auto: true, check: "crc32", speed: 6, sample: "random_256k.bin" },
    script: [
      { at: 0.0, ch: { mode: "noise", rate: 0.25, bits: 1, pattern: "random", delay_ms: 0, loss: 0 } },
      { at: 0.25, ch: { mode: "noise", rate: 0.3, bits: 3, pattern: "random", delay_ms: 0, loss: 0 } },
      { at: 0.5, ch: { mode: "clean", rate: 0.1, bits: 1, pattern: "random", delay_ms: 0, loss: 0 } },
      { at: 0.72, ch: { mode: "attack", rate: 0.15, bits: 1, pattern: "random", delay_ms: 0, loss: 0 } },
    ],
    doText: "One bigger file, and the network keeps changing: single-bit noise, then burst errors, then a clean stretch, then a hacker. Auto Defense has to react with no help from us.",
    watch: "Follow the timeline: Hamming switches on, chunks get smaller, Hamming switches off again, then an intrusion alert and an automatic retry with HMAC.",
    happened: (ev) => (ev.decisions || []).length
      ? `Auto Defense took ${plural(ev.decisions.length, "decision")}: ` + ev.decisions.map((d) => d.reason).join(" • ") + `. Final result: ${ev.verified ? "verified" : "rejected"}.`
      : `No action was needed. Final result: ${ev.verified ? "verified" : "rejected"}.`,
    matters: "Protection costs bandwidth, so the best system uses only what the link needs right now — and still never accepts a bad file.",
  },
  {
    short: "Checksum vs CRC", title: "Checksum fooled by reordering — CRC catches it",
    runs: [
      { channel: { mode: "noise", rate: 0.3, bits: 1, pattern: "swap" }, fec: false, hmac: false, auto: false, check: "checksum16", speed: 30, sample: "sample.txt", label: "Demo 7a: word swap, Checksum-16" },
      { channel: { mode: "noise", rate: 0.3, bits: 1, pattern: "swap" }, fec: false, hmac: false, auto: false, check: "crc32", speed: 30, sample: "sample.txt", label: "Demo 7b: word swap, CRC32" },
    ],
    doText: "The network now swaps two 16-bit words inside some chunks. First the sender uses the classic 16-bit Internet checksum, then CRC32 — on exactly the same kind of damage.",
    watch: "Run 1: every square stays green because the checksum cannot see a reordering — yet the verdict is FILE TAMPERED. Run 2: red squares appear, chunks are re-sent, and the file verifies.",
    happened: (ev, all) => `Checksum run: ${all[0].verified ? "verified (no word-swap happened to be hit)" : "every chunk passed, but the file was rejected and quarantined"}. CRC32 run: ${all[1].verified ? `verified after ${plural(all[1].retransmits, "re-send")}` : "rejected"}.`,
    matters: "A checksum adds the words up, so reordering them leaves the total unchanged. CRC treats the position of every bit as part of the value, so it notices. That is why our protocol uses CRC32 by default and keeps the checksum for comparison.",
  },
];

const wordsMs = (...t) => Math.min(14000, Math.max(6000, t.join(" ").split(/\s+/).length * 270));

export function initDemo(api) {
  const st = { mode: null, idx: 0, phase: "before", paused: false, abort: false, results: [] };
  const card = $("#guide");
  const resumeWaiters = [];

  function say(text) {
    if (!$("#guide-voice").checked || !("speechSynthesis" in window)) return Promise.resolve();
    return new Promise((res) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02; u.onend = res; u.onerror = res;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      setTimeout(res, 20000);
    });
  }
  const stopSpeech = () => { try { speechSynthesis.cancel(); } catch { /* none */ } };

  async function hold(ms) {                       // narration pause that honours pause / exit
    const end = Date.now() + ms;
    while (Date.now() < end && !st.abort) {
      if (st.paused) await new Promise((r) => resumeWaiters.push(r));
      else await api.sleep(150);
    }
  }

  function dots() {
    $("#guide-dots").innerHTML = STEPS.map((s, i) =>
      `<button class="dot ${i === st.idx ? "on" : ""} ${st.results[i] ? "done" : ""}" title="${s.short}" data-i="${i}" aria-label="Step ${i + 1}: ${s.short}"></button>`).join("");
    $("#guide-dots").querySelectorAll(".dot").forEach((d) => d.addEventListener("click", () => {
      if (st.mode === "guided" && !api.isBusy()) { st.idx = +d.dataset.i; renderBefore(); }
    }));
  }
  function renderBefore() {
    const s = STEPS[st.idx];
    st.phase = "before";
    $("#guide-step").textContent = `Step ${st.idx + 1} of ${STEPS.length}`;
    $("#guide-title").textContent = s.title;
    $("#guide-do").textContent = s.doText;
    $("#guide-watch").textContent = s.watch;
    $("#guide-after").hidden = true;
    $("#guide-before").hidden = false;
    $("#guide-run").hidden = st.mode === "full"; $("#guide-run").disabled = false;
    $("#guide-run").textContent = "Run this step";
    $("#guide-next").hidden = true;
    $("#guide-prev").hidden = st.mode === "full" || st.idx === 0;
    $("#guide-pause").hidden = st.mode !== "full";
    dots();
  }
  function renderAfter(s, res) {
    st.phase = "after";
    const ev = res?.ev;
    const ok = res && res.kind === "done";
    $("#guide-happened").textContent = ok ? s.happened(ev, res.all) : "The transfer did not complete — check the red banner or toast for what to fix, then run the step again.";
    $("#guide-matters").textContent = s.matters;
    $("#guide-before").hidden = true;                 // "after" replaces "before": the card keeps a constant height
    $("#guide-after").hidden = false;
    $("#guide-run").hidden = st.mode === "full" || ok;
    $("#guide-run").textContent = "Run again";
    $("#guide-next").hidden = st.mode === "full" || !ok;
    $("#guide-next").textContent = st.idx === STEPS.length - 1 ? "Finish ✓" : "Next →";
    st.results[st.idx] = ok;
    dots();
  }

  function startScript(script) {
    let i = 0, attempt = 1;
    const off = api.onTelemetry((ev) => {
      if (ev.src === "client" && ev.ev === "start") { attempt = ev.attempt || 1; }
      if (ev.src === "client" && ev.ev === "progress" && attempt === 1) {
        const frac = ev.done / Math.max(1, ev.total);
        while (i < script.length && frac >= script[i].at) { api.setChannel(script[i].ch); i++; }
      }
    });
    return off;
  }

  async function runStep(i) {
    const s = STEPS[i];
    api.showTab("transfer");
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("#guide-run").disabled = true;
    const runs = s.runs || [{ ...s.cfg, label: `Demo ${i + 1}: ${s.short}` }];
    const all = [];
    let res = null;
    for (const cfg of runs) {                       // most steps are one transfer; step 7 is two (checksum, then CRC)
      api.applyConfig(cfg);
      const stop = s.script ? startScript(s.script) : null;
      res = await api.startTransfer();
      stop?.();
      if (!res || res.kind !== "done" || st.abort) break;
      all.push(res.ev);
      if (cfg !== runs[runs.length - 1]) await api.sleep(3500);       // let the first verdict be read
    }
    return res && { ...res, all };
  }

  function open(mode) {
    if (api.isBusy()) { api.toast("warning", "A transfer is running", "Wait for it to finish, then start the demo.", { key: "busy" }); return false; }
    Object.assign(st, { mode, idx: 0, abort: false, paused: false, results: [] });
    api.closeWelcome();
    api.showTab("transfer");
    card.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  }
  function close() {
    st.abort = true; st.mode = null;
    resumeWaiters.splice(0).forEach((r) => r());
    stopSpeech();
    card.hidden = true;
  }

  async function startGuided() {
    if (!open("guided")) return;
    renderBefore();
    say(`${STEPS[0].doText} ${STEPS[0].watch}`);
  }

  async function startFull() {
    if (!open("full")) return;
    api.toast("info", "Full demo started", "Six scenarios, narrated on screen. Use pause or exit at any time.", { ttl: 5000 });
    for (let i = 0; i < STEPS.length && !st.abort; i++) {
      st.idx = i;
      const s = STEPS[i];
      renderBefore();
      await Promise.all([say(`Step ${i + 1}. ${s.title}. ${s.doText} ${s.watch}`), hold(wordsMs(s.doText, s.watch))]);
      if (st.abort) break;
      const res = await runStep(i);
      if (st.abort) break;
      renderAfter(s, res);
      await api.sleep(1200);
      await Promise.all([say(`${$("#guide-happened").textContent} ${s.matters}`), hold(wordsMs($("#guide-happened").textContent, s.matters))]);
    }
    if (!st.abort) {
      api.toast("success", "Demo complete", "All six scenarios ran. See “Results so far” for the summary table.", { ttl: 8000 });
      $("#guide-step").textContent = "Demo complete";
      $("#guide-title").textContent = "That was all six scenarios";
      $("#guide-before").hidden = true;
      $("#guide-pause").hidden = true;
      $("#guide-happened").textContent = `Scenarios that ended with a verified file: ${st.results.filter(Boolean).length} of ${STEPS.length}.`;
      $("#guide-matters").textContent = "Scroll down to “Results so far” for the table you can download as a report.";
      document.getElementById("card-session").scrollIntoView({ behavior: "smooth", block: "center" });
    }
    st.mode = null;
  }

  $("#guide-run").addEventListener("click", async () => {
    if (st.mode !== "guided" || api.isBusy()) return;
    const s = STEPS[st.idx];
    const res = await runStep(st.idx);
    if (st.mode !== "guided") return;
    if (!res) { $("#guide-run").disabled = false; return; }
    renderAfter(s, res);
    say(`${$("#guide-happened").textContent} ${s.matters}`);
  });
  $("#guide-next").addEventListener("click", () => {
    stopSpeech();
    if (st.idx >= STEPS.length - 1) { api.toast("success", "Guided demo finished", "Open “Results so far” to download your report.", { ttl: 6000 }); close(); return; }
    st.idx++; renderBefore();
    say(`${STEPS[st.idx].doText} ${STEPS[st.idx].watch}`);
  });
  $("#guide-prev").addEventListener("click", () => { if (st.idx > 0 && !api.isBusy()) { st.idx--; renderBefore(); } });
  $("#guide-stop").addEventListener("click", close);
  $("#guide-pause").addEventListener("click", (e) => {
    st.paused = !st.paused;
    e.currentTarget.textContent = st.paused ? "resume" : "pause";
    if (st.paused) try { speechSynthesis.pause(); } catch { /* none */ }
    else { try { speechSynthesis.resume(); } catch { /* none */ } resumeWaiters.splice(0).forEach((r) => r()); }
  });

  return { startGuided, startFull };
}
