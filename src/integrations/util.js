'use strict';
// Petit client HTTP commun aux intégrations : JSON in/out, erreurs lisibles.

async function apiFetch(url, { method = 'GET', headers = {}, body = null, timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`Réseau injoignable (${method} ${url}) : ${e.message}`);
  }
  clearTimeout(timer);

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* réponse non-JSON */ }

  if (!res.ok) {
    const detail = json ? JSON.stringify(json).slice(0, 600) : text.slice(0, 600);
    const err = new Error(`HTTP ${res.status} sur ${method} ${url} — ${detail || 'sans détail'}`);
    err.status = res.status;
    err.body = json || text;
    throw err;
  }
  return json;
}

module.exports = { apiFetch };
