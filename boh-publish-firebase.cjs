/**
 * Publish processed BOH venue week JSON + scrapeStatus to Firebase.
 * Never uploads raw kitchen-timing / item-details / rolling.json.
 *
 * Usage:
 *   node boh-publish-firebase.cjs [weekLabel]
 *   node boh-publish-firebase.cjs --all
 *   node boh-publish-firebase.cjs --from 2026-W01 --to 2026-W34
 *
 * Reads pipeline-health.json for latest week if omitted.
 * meta.weeks retains the full published history (no 3-week cap) so Period/Year
 * views can discover and load earlier fiscal weeks on demand.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = process.env.BOH_ROOT || __dirname;
const FB_DB = 'rdg-dj-dashboard-default-rtdb.firebaseio.com';

const PROCESS_VENUES = [
  { slug: 'claudie', key: 'claudie', label: 'Claudie' },
  { slug: 'casa_neos', key: 'casaneos', label: 'Casa Neos' },
  { slug: 'ava_coconut_grove', key: 'ava_cg', label: 'AVA Coconut Grove' },
  { slug: 'ava_winter_park', key: 'ava_wp', label: 'AVA Winter Park' },
  { slug: 'mila', key: 'mila', label: 'MILA' },
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function fbPut(fbPath, payload) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: FB_DB,
      path: fbPath + '.json',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res({ code: r.statusCode, body: d }));
    });
    req.on('error', rej);
    req.write(body);
    req.end();
  });
}

function fbGet(fbPath) {
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: FB_DB,
      path: fbPath + '.json',
      method: 'GET',
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode < 200 || r.statusCode >= 300) {
          return rej(new Error(`Firebase GET ${fbPath} HTTP ${r.statusCode}`));
        }
        try { res(d ? JSON.parse(d) : null); } catch (e) { rej(e); }
      });
    });
    req.on('error', rej);
    req.end();
  });
}

function loadHealth() {
  const p = path.join(ROOT, 'pipeline-health.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Firebase rejects empty keys and keys containing . # $ [ ] / */
function sanitizeForFirebase(value) {
  if (Array.isArray(value)) return value.map(sanitizeForFirebase);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!k || /[.#$[\]/]/.test(k)) continue;
    out[k] = sanitizeForFirebase(v);
  }
  return out;
}

function discoverLocalWeeks() {
  const found = new Set();
  for (const file of fs.readdirSync(ROOT)) {
    const m = file.match(/-data-(\d{4}-W\d{2})\.json$/);
    if (m) found.add(m[1]);
  }
  return [...found].sort();
}

function parseArgs(argv) {
  const out = { all: false, from: null, to: null, weeks: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--from') out.from = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (/^\d{4}-W\d{2}$/.test(a)) out.weeks.push(a);
  }
  return out;
}

function resolveWeeks(args, health) {
  if (args.all || (args.from && args.to)) {
    let weeks = discoverLocalWeeks();
    if (args.from) weeks = weeks.filter((w) => w >= args.from);
    if (args.to) weeks = weeks.filter((w) => w <= args.to);
    return weeks;
  }
  if (args.weeks.length) return args.weeks;
  const one = health?.latestWeek;
  if (!one) throw new Error('No weekLabel (pass arg, --all, or run pipeline-health.cjs first)');
  return [one];
}

async function publishWeek(weekLabel) {
  const published = [];
  const missing = [];
  for (const v of PROCESS_VENUES) {
    const file = path.join(ROOT, `${v.slug}-data-${weekLabel}.json`);
    if (!fs.existsSync(file)) {
      missing.push(v.slug);
      continue;
    }
    const data = sanitizeForFirebase(JSON.parse(fs.readFileSync(file, 'utf8')));
    const fbPath = `/rdg/boh/weeks/${weekLabel}/${v.key}`;
    const { code } = await fbPut(fbPath, data);
    if (code < 200 || code >= 300) throw new Error(`Firebase PUT ${fbPath} HTTP ${code}`);
    log(`PUT ${fbPath} HTTP ${code} (${Math.round(Buffer.byteLength(JSON.stringify(data)) / 1024)} KB)`);
    published.push(v.key);
  }
  if (!published.length) {
    log(`SKIP ${weekLabel} — no venue files`);
    return { weekLabel, published, missing, skipped: true };
  }
  if (missing.length) log(`WARN ${weekLabel} missing venues: ${missing.join(', ')}`);
  return { weekLabel, published, missing, skipped: false };
}

async function main() {
  const health = loadHealth();
  const args = parseArgs(process.argv.slice(2));
  const weekLabels = resolveWeeks(args, health);
  if (!weekLabels.length) throw new Error('No weeks to publish');

  log(`Publishing ${weekLabels.length} week(s): ${weekLabels[0]} → ${weekLabels[weekLabels.length - 1]}`);

  const results = [];
  for (const weekLabel of weekLabels) {
    results.push(await publishWeek(weekLabel));
  }

  const now = new Date();
  let previousMeta = null;
  try { previousMeta = await fbGet('/rdg/boh/meta'); } catch (_) {}

  // Keep full published history so Period/Year can discover early weeks.
  // Also merge any weeks already present in Firebase (shallow list) when available.
  let remoteWeeks = [];
  try {
    const shallow = await fbGet('/rdg/boh/weeks');
    if (shallow && typeof shallow === 'object') remoteWeeks = Object.keys(shallow);
  } catch (_) {}

  const publishedOk = results.filter((r) => !r.skipped).map((r) => r.weekLabel);
  const latestWeek = [...publishedOk].sort().reverse()[0]
    || health?.latestWeek
    || previousMeta?.latestWeek
    || weekLabels[weekLabels.length - 1];

  const weeks = Array.from(new Set([
    ...publishedOk,
    ...remoteWeeks,
    ...((previousMeta && Array.isArray(previousMeta.weeks)) ? previousMeta.weeks : []),
  ])).sort().reverse();

  const meta = {
    latestWeek,
    weeks,
    updatedAt: now.toISOString(),
    venues: PROCESS_VENUES.map(v => v.key),
    source: 'github_actions_hosted'
  };
  const metaRes = await fbPut('/rdg/boh/meta', meta);
  log(`PUT /rdg/boh/meta HTTP ${metaRes.code} weeks=${weeks.length} latest=${latestWeek}`);

  const ok = !health || health.overall !== 'fail';
  const status = {
    ok,
    at: now.toISOString(),
    atLocal: now.toLocaleString('en-US', { timeZone: 'America/New_York' }),
    weekLabel: latestWeek,
    schedule: 'Mon ~8:30 AM ET (GitHub-hosted Actions · backup ~9:00 AM)',
    what: 'BOH weekly Toast+OT → processed venue JSON → Firebase + Pages',
    message: ok
      ? `Published ${publishedOk.length} week(s); meta tracks ${weeks.length} weeks`
      : `Health failed for ${latestWeek} — check pipeline-health.json`,
    totals: health?.totals || null,
    venues: (health?.venues || []).map(v => ({ slug: v.slug, label: v.label, overall: v.overall })),
    source: 'bohWeekly'
  };
  const st = await fbPut('/rdg/scrapeStatus/bohWeekly', status);
  log(`PUT /rdg/scrapeStatus/bohWeekly HTTP ${st.code} ok=${ok}`);

  const day = now.toISOString().slice(0, 10);
  await fbPut(`/rdg/scrapeLog/${day}/bohWeekly`, status);

  if (!ok) process.exit(1);
  log('Firebase publish complete');
}

main().catch(e => {
  console.error('[boh-publish-firebase] ERROR', e.message || e);
  process.exit(1);
});
