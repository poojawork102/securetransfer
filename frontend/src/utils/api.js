const BASE = "";

async function request(url, opts = {}) {
  const res = await fetch(BASE + url, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function getHealth() {
  return request("/api/health");
}

export function getSamples() {
  return request("/api/samples");
}

export function sendFile(formData) {
  return request("/api/send", { method: "POST", body: formData });
}

export function setProxy(config) {
  return request("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}

export function getSession() {
  return request("/api/session");
}

export function clearSession() {
  return request("/api/session/clear", { method: "POST" });
}

export function getResults() {
  return request("/api/results");
}

export function solveNumerical(body) {
  return request("/api/numerical", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
