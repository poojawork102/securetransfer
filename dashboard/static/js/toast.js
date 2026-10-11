// Bottom-right toast notifications.
//  - max 4 visible, newest on top, older ones shrink; extra ones collapse into a "+N earlier" chip
//  - hover (or keyboard focus) pauses the auto-dismiss timer, every toast has a close button
//  - info/success vanish after 4 s, warning after 6 s, danger/security stay until closed
//  - `key` merges bursts: toast("warning", "...", "", {key: "corrupt", merge: n => `${n} chunks damaged`})
//    updates one toast instead of stacking twelve
const box = document.getElementById("toasts");
const ICON = { info: "ℹ", success: "✓", warning: "⚠", danger: "✕", security: "⛨" };
const TTL = { info: 4000, success: 4000, warning: 6000, danger: 0, security: 0 };
const MAX_VISIBLE = 4;
const items = []; // newest first
let soundOn = false;
let audio = null;

export function setSound(on) { soundOn = on; }

function beep(type) {
  if (!soundOn || !["danger", "security", "warning"].includes(type)) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const tones = type === "security" ? [660, 880] : type === "danger" ? [330, 220] : [520];
    tones.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, audio.currentTime + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + i * 0.14 + 0.13);
      o.connect(g); g.connect(audio.destination);
      o.start(audio.currentTime + i * 0.14); o.stop(audio.currentTime + i * 0.14 + 0.14);
    });
  } catch { /* audio is a nicety only */ }
}

function layout() {
  items.forEach((it, idx) => {
    const hidden = idx >= MAX_VISIBLE;
    it.el.hidden = hidden;
    it.el.classList.toggle("older", idx >= 2 && !hidden);
    it.el.style.setProperty("--depth", Math.min(idx, 3));
  });
  let chip = box.querySelector(".toast-more");
  const extra = items.length - MAX_VISIBLE;
  if (extra > 0) {
    if (!chip) {
      chip = document.createElement("button");
      chip.className = "toast-more";
      chip.addEventListener("click", () => { items.slice(MAX_VISIBLE).forEach((i) => i.close()); });
      box.appendChild(chip);
    }
    chip.textContent = `+${extra} earlier · dismiss`;
  } else if (chip) chip.remove();
}

function arm(it) {
  clearTimeout(it.timer);
  if (!it.ttl) return;
  it.started = Date.now();
  it.timer = setTimeout(() => it.close(), it.left);
}

export function toast(type, title, text = "", opts = {}) {
  // merge into an existing toast with the same key
  if (opts.key) {
    const old = items.find((i) => i.key === opts.key && !i.closing);
    if (old) {
      old.count += 1;
      const t = opts.merge ? opts.merge(old.count) : text;
      old.bodyEl.textContent = t;
      old.badge.textContent = `×${old.count}`; old.badge.hidden = false;
      items.splice(items.indexOf(old), 1); items.unshift(old); box.prepend(old.el);
      old.left = old.ttl; arm(old); layout();
      return old;
    }
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "danger" || type === "security" ? "alert" : "status");
  el.tabIndex = 0;
  el.innerHTML = `<span class="t-ico" aria-hidden="true">${ICON[type] || "ℹ"}</span>
    <div class="t-main"><b></b><span class="t-badge" hidden></span><p></p>${opts.hint ? "<code></code>" : ""}</div>
    <button class="t-x" aria-label="Dismiss notification">×</button>`;
  el.querySelector("b").textContent = title;
  el.querySelector("p").textContent = opts.merge ? opts.merge(1) : text;
  if (opts.hint) el.querySelector("code").textContent = opts.hint;
  const it = { el, type, key: opts.key, count: 1, ttl: opts.ttl ?? TTL[type], timer: 0, closing: false,
    bodyEl: el.querySelector("p"), badge: el.querySelector(".t-badge") };
  it.left = it.ttl;
  it.close = () => {
    if (it.closing) return;
    it.closing = true; clearTimeout(it.timer);
    el.classList.add("leaving");
    setTimeout(() => { el.remove(); const i = items.indexOf(it); if (i >= 0) items.splice(i, 1); layout(); }, 220);
  };
  el.querySelector(".t-x").addEventListener("click", it.close);
  const pause = () => { if (it.ttl) { clearTimeout(it.timer); it.left = Math.max(1200, it.left - (Date.now() - it.started)); } };
  el.addEventListener("mouseenter", pause); el.addEventListener("focusin", pause);
  el.addEventListener("mouseleave", () => arm(it)); el.addEventListener("focusout", () => arm(it));
  items.unshift(it);
  box.prepend(el);
  layout(); arm(it); beep(type);
  return it;
}

export const clearToasts = () => items.slice().forEach((i) => i.close());
