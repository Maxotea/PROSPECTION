'use strict';
// Parseur CSV maison (zéro dépendance) : gère guillemets, retours ligne quotés,
// séparateur auto-détecté (, ; ou tabulation) et BOM.

function detectDelimiter(firstLine) {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

function parse(text) {
  let s = String(text || '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // BOM
  const firstNl = s.indexOf('\n');
  const delim = detectDelimiter(firstNl === -1 ? s : s.slice(0, firstNl));

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);

  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => String(h).trim());
  return { headers, rows: rows.slice(1), delimiter: delim };
}

function toCsv(headers, rows) {
  const esc = (v) => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(','));
  return '\uFEFF' + lines.join('\r\n'); // BOM pour qu'Excel ouvre l'UTF-8 proprement
}

// Auto-détection du mapping colonnes CSV → champs contact.
// Couvre les exports LinkedIn (Connections.csv), Sales Navigator via FullEnrich,
// HubSpot, et les intitulés français usuels.
const FIELD_PATTERNS = {
  first_name: [/^first[ _-]?name$/i, /^pr[ée]nom$/i, /^firstname$/i],
  last_name: [/^last[ _-]?name$/i, /^nom$/i, /^lastname$/i, /^surname$/i],
  email: [/^e-?mail([ _-]?address)?$/i, /^courriel$/i, /work[ _-]?email/i, /^most[ _-]?probable[ _-]?email$/i, /^adresse[ _-]?e-?mail$/i],
  phone: [/^phone([ _-]?number)?$/i, /^t[ée]l[ée]phone$/i, /^mobile([ _-]?phone)?$/i, /^most[ _-]?probable[ _-]?phone$/i, /^num[ée]ro/i],
  company: [/^company([ _-]?name)?$/i, /^entreprise$/i, /^soci[ée]t[ée]$/i, /^organisation$/i, /^account$/i],
  job_title: [/^(job[ _-]?)?title$/i, /^poste$/i, /^position$/i, /^fonction$/i, /^job$/i],
  linkedin_url: [/linkedin/i, /^url$/i, /^profile[ _-]?url$/i, /^profil$/i],
  domain: [/^domain$/i, /^website$/i, /^site([ _-]?web)?$/i, /^company[ _-]?domain/i],
  city: [/^city$/i, /^ville$/i, /^location$/i, /^localisation$/i],
  country: [/^country$/i, /^pays$/i],
  notes: [/^notes?$/i, /^commentaires?$/i],
};

function autoMap(headers) {
  const mapping = {};
  const used = new Set();
  for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      if (patterns.some((p) => p.test(headers[i].trim()))) {
        mapping[field] = i;
        used.add(i);
        break;
      }
    }
  }
  return mapping;
}

module.exports = { parse, toCsv, autoMap, FIELD_PATTERNS };
