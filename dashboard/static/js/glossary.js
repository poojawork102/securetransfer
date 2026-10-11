// One-sentence plain-English explanations for every technical term. Any element like
//   <span class="term" tabindex="0" data-term="crc32">CRC32</span>
// gets a tooltip (hover, keyboard focus or tap). Works for elements added later, too.
export const GLOSSARY = {
  crc32: "CRC32: a 32-bit fingerprint of each chunk — if even one bit changes in transit, the fingerprint almost surely changes.",
  checksum: "Checksum: add up the chunk as 16-bit numbers and send the inverted total; cheap, but it misses some errors, like two swapped words.",
  hamming: "Hamming(7,4): an error-correcting code — 4 data bits get 3 extra parity bits, so the receiver can find and fix any single flipped bit by itself.",
  hmac: "HMAC: a fingerprint made with a secret key — an attacker who rewrites the data cannot recompute it, so forgeries are caught.",
  arq: "ARQ (stop-and-wait): send a chunk, wait for the receiver's OK (ACK); if it says NACK or stays silent, send that chunk again.",
  rtt: "RTT (round-trip time): how long it takes from sending a chunk until its acknowledgement comes back.",
  jitter: "Jitter: how much the round-trip time wobbles from chunk to chunk — a steady link has low jitter.",
  overhead: "Overhead: the extra bytes sent on top of the file itself (headers, Hamming parity bits, re-sent chunks).",
  retransmit: "Retransmit: sending the same chunk again because it arrived damaged or its acknowledgement never came.",
  sha256: "SHA-256: a fingerprint of the whole file — if the received file's fingerprint differs, something changed.",
  autodefense: "Auto Defense: the sender watches how the network behaves and switches Hamming, smaller chunks or HMAC on and off by itself — and a file that fails the final check is never accepted.",
  quarantine: "Quarantine: a locked folder for files that failed verification. They never reach the normal 'received' folder.",
  mitm: "MITM (man-in-the-middle): someone on the network who rewrites data while it is travelling.",
  throughput: "Throughput: how many kilobytes per second actually got through.",
  fec: "FEC (forward error correction): extra redundancy that lets the receiver repair some damage without asking for a re-send.",
  chunk: "Chunk: one numbered piece of the file (1 KB by default) sent as a single frame.",
  tcp: "TCP: the reliable, ordered byte stream that carries all our frames between client and server.",
};

const tip = document.createElement("div");
tip.id = "tip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
document.body.appendChild(tip);

function show(el) {
  const text = GLOSSARY[el.dataset.term] || el.dataset.tip;
  if (!text) return;
  tip.textContent = text; tip.hidden = false;
  const r = el.getBoundingClientRect(), w = Math.min(320, innerWidth - 16);
  tip.style.maxWidth = w + "px";
  let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  const h = tip.offsetHeight;
  let top = r.top - h - 8;
  if (top < 8) top = r.bottom + 8;
  tip.style.left = left + "px"; tip.style.top = top + "px";
}
const hide = () => { tip.hidden = true; };

document.addEventListener("mouseover", (e) => { const t = e.target.closest?.(".term"); if (t) show(t); });
document.addEventListener("mouseout", (e) => { if (e.target.closest?.(".term")) hide(); });
document.addEventListener("focusin", (e) => { const t = e.target.closest?.(".term"); if (t) show(t); });
document.addEventListener("focusout", hide);
document.addEventListener("click", (e) => {
  const t = e.target.closest?.(".term");
  if (t) { t.focus?.(); show(t); } else hide();
});
