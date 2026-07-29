/**
 * Publish processed BOH venue week JSON + scrapeStatus to Firebase.
 * Never uploads raw kitchen-timing / item-details / rolling.json.
 *
 * Usage: node boh-publish-firebase.cjs [weekLabel]
 * Reads pipeline-health.json for latest week if omitted.
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

async function main() {
  const health = loadHealth();
  const weekLabel = process.argv[2] || health?.latestWeek;
  if (!weekLabel) throw new Error('No weekLabel (pass arg or run pipeline-health.cjs first)');

  const published = [];
  for (const v of PROCESS_VENUES) {
    const file = path.join(ROOT, `${v.slug}-data-${weekLabel}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`Missing processed file: ${file}`);
    }
    const data = sanitizeForFirebase(JSON.parse(fs.readFileSync(file, 'utf8')));
    const fbPath = `/rdg/boh/weeks/${weekLabel}/${v.key}`;
    const { code } = await fbPut(fbPath, data);
    if (code < 200 || code >= 300) throw new Error(`Firebase PUT ${fbPath} HTTP ${code}`);
    log(`PUT ${fbPath} HTTP ${code} (${Math.round(Buffer.byteLength(JSON.stringify(data)) / 1024)} KB)`);
    published.push(v.key);
  }

  const now = new Date();
  const meta = {
    latestWeek: weekLabel,
    updatedAt: now.toISOString(),
    venues: PROCESS_VENUES.map(v => v.key),
    source: 'boh_weekly_cloud'
  };
  const metaRes = await fbPut('/rdg/boh/meta', meta);
  log(`PUT /rdg/boh/meta HTTP ${metaRes.code}`);

  const ok = !health || health.overall !== 'fail';
  const status = {
    ok,
    at: now.toISOString(),
    atLocal: now.toLocaleString('en-US', { timeZone: 'America/New_York' }),
    weekLabel,
    schedule: 'Mon ~8:25 AM ET (cron-job.org → workflow_dispatch · self-hosted runner)',
    what: 'BOH weekly Toast+OT → processed venue JSON → Firebase + Pages',
    message: ok
      ? `Published ${weekLabel} for ${published.length} venues`
      : `Health failed for ${weekLabel} — check pipeline-health.json`,
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
