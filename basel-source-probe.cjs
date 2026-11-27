/**
 * One-off probe: what fields does a FourVenues booking carry (source / channel)?
 * Repo is PUBLIC: the log prints only field names, types and aggregate counts.
 * Sanitized per-booking rows (no names, emails, phones) go to an artifact.
 */
'use strict';
const fs = require('fs');
const { VENUES, getApiKey, listBookings, isCountableStatus, BASE } = require('./fv-api-client.cjs');

const WEEKEND = ['2026-12-04', '2026-12-05', '2026-12-06'];
const PLAN = {
  casa_neos_bc: WEEKEND,
  casa_neos_lounge: WEEKEND,
  mila_lounge: ['2026-12-01', '2026-12-02', '2026-12-03', ...WEEKEND]
};

const PII_KEY = /(e-?mail|phone|tel\b|telephone|mobile|whatsapp|instagram|dni|passport|document|address|birth|surname|last_?name|first_?name|full_?name|nif|nie|card|iban|ip_?address)/i;
const PERSON_PATH = /(^|\.)(client|user|customer|guest|person|profile|booker|owner|contact|lead|holder)(\.|$)/i;
const KEEP_KEY = /(source|channel|origin|referr|utm|platform|via|medium|promo|campaign|app|web|portal|pos|ticket|type|kind|category|method|created_by|booked_by)/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/;

function isPiiPath(p) {
  if (PII_KEY.test(p)) return true;
  if (PERSON_PATH.test(p) && /(^|\.)(name|id|label|title)$/i.test(p) && !/(^|\.)(referral)/i.test(p)) return true;
  return false;
}

function flatten(obj, prefix, out, depth) {
  if (obj == null) { out[prefix] = null; return; }
  if (Array.isArray(obj)) {
    if (!obj.length) { out[prefix] = '[]'; return; }
    if (obj.every(x => x == null || typeof x !== 'object')) { out[prefix] = obj.map(String).join('|'); return; }
    out[prefix + '#len'] = obj.length;
    if (depth < 3) obj.slice(0, 3).forEach((x, i) => flatten(x, prefix + '[' + i + ']', out, depth + 1));
    return;
  }
  if (typeof obj === 'object') {
    if (depth >= 4) { out[prefix] = '{...}'; return; }
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? prefix + '.' + k : k, out, depth + 1);
    return;
  }
  out[prefix] = obj;
}

const FREE_TEXT = /(note|comment|remark|observ|message|description|request|special|allerg)/i;
function safeValue(path, v) {
  if (v == null) return null;
  if (FREE_TEXT.test(path) && !KEEP_KEY.test(path)) return String(v).trim() ? '[text]' : null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  if (EMAIL_RE.test(s) || PHONE_RE.test(s)) return '[masked]';
  if (s.length > 60 && !KEEP_KEY.test(path)) return '[text ' + s.length + ']';
  return s;
}

async function apiGet(key, p) {
  const res = await fetch(BASE + p, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 200) }; }
  return { status: res.status, data };
}

(async () => {
  const rows = [];
  const detailProbe = [];
  for (const [vk, dates] of Object.entries(PLAN)) {
    const venue = VENUES.find(v => v.key === vk);
    const key = getApiKey(venue);
    if (!key) { console.log('NO KEY for', vk); continue; }
    let names = new Map();
    try {
      const u = await apiGet(key, '/users/');
      for (const user of (u.data && u.data.data) || []) {
        const p = user.profile || {};
        const label = [p.name, p.last_name].filter(Boolean).join(' ').trim();
        if (user._id && label) names.set(user._id, label);
      }
    } catch (_) {}
    for (const date of dates) {
      const { bookings } = await listBookings(venue, { date });
      let probed = 0;
      for (const b of bookings) {
        const flat = {};
        flatten(b, '', flat, 0);
        const row = { _venue: venue.name, _date: date, _countable: isCountableStatus(b.status || b.state) };
        row._referrer = b.referral_id ? (names.get(b.referral_id) || 'Unknown referrer') : 'No referrer';
        for (const [p, v] of Object.entries(flat)) {
          const path = p.replace(/^\./, '');
          if (isPiiPath(path)) continue;
          row[path] = safeValue(path, v);
        }
        rows.push(row);
        /* Try a detail call for a few bookings to see whether it carries more fields than the list. */
        if (probed < 1 && b._id && detailProbe.length < 3) {
          probed++;
          try {
            const d = await apiGet(key, '/bookings/' + encodeURIComponent(b._id) + '/');
            const df = {};
            flatten((d.data && (d.data.data || d.data)) || {}, '', df, 0);
            detailProbe.push({ venue: venue.name, status: d.status, keys: Object.keys(df).map(k => k.replace(/^\./, '')).filter(k => !isPiiPath(k)) });
          } catch (e) { detailProbe.push({ venue: venue.name, error: e.message.slice(0, 120) }); }
        }
      }
    }
  }

  console.log('rows total:', rows.length, ' countable:', rows.filter(r => r._countable).length);

  /* Schema + distributions (log is public: names/counts only) */
  const keys = new Map();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (k.startsWith('_')) continue;
      if (!keys.has(k)) keys.set(k, { n: 0, vals: new Map() });
      const e = keys.get(k);
      if (v != null) e.n++;
      const sv = v == null ? '(null)' : String(v);
      e.vals.set(sv, (e.vals.get(sv) || 0) + 1);
    }
  }
  console.log('\n=== FIELD SCHEMA (path | non-null | distinct | top values when <=15 distinct) ===');
  for (const [k, e] of [...keys.entries()].sort()) {
    const distinct = e.vals.size;
    let line = `${k} | ${e.n}/${rows.length} | ${distinct}`;
    if (distinct <= 15 && !isPiiPath(k) && (KEEP_KEY.test(k) || /status|state|currency|payment|paid|method/i.test(k))) {
      line += ' | ' + [...e.vals.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => `${v.slice(0, 40)}:${c}`).join(', ');
    }
    console.log(line);
  }
  console.log('\n=== DETAIL ENDPOINT KEYS ===');
  console.log(JSON.stringify(detailProbe, null, 1).slice(0, 6000));

  fs.writeFileSync('basel-bookings-sanitized.json', JSON.stringify(rows, null, 1));
  console.log('\nwrote basel-bookings-sanitized.json', rows.length);
})().catch(e => { console.error(e.message); process.exit(1); });
