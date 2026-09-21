'use strict';
/**
 * Exec publish gate — block Firebase/Pages publish unless the latest week is complete.
 * Usage: node exec-publish-gate.cjs [YYYY-Www]
 * Exit 0 = safe to publish; exit 1 = block publish.
 */
const fs = require('fs');
const path = require('path');
const { STAFFING_VENUES } = require('./boh-staffing-shared.cjs');

const ROOT = __dirname;
const WEEK =
  process.argv[2] ||
  (() => {
    const weeks = fs
      .readdirSync(path.join(ROOT, 'data'))
      .filter((d) => /^\d{4}-W\d{2}$/.test(d))
      .sort();
    return weeks[weeks.length - 1] || null;
  })();

const REQUIRED = STAFFING_VENUES || [
  'claudie',
  'casa_neos',
  'ava_coconut_grove',
  'ava_winter_park',
  'mila',
];

const IPSH_WARN = 25;
const IPSH_FAIL = 90;
const fails = [];
const warns = [];

function fail(msg) {
  fails.push(msg);
  console.error('❌', msg);
}
function warn(msg) {
  warns.push(msg);
  console.warn('⚠️ ', msg);
}
function ok(msg) {
  console.log('✅', msg);
}

if (!WEEK) {
  console.error('No week found');
  process.exit(1);
}

console.log(`\n=== Exec publish gate · ${WEEK} ===\n`);

const weekDir = path.join(ROOT, 'data', WEEK);
if (!fs.existsSync(weekDir)) fail(`Missing data/${WEEK}/`);

const phPath = path.join(ROOT, 'pipeline-health.json');
if (!fs.existsSync(phPath)) {
  fail('pipeline-health.json missing — run pipeline-health.cjs first');
} else {
  const ph = JSON.parse(fs.readFileSync(phPath, 'utf8'));
  if (ph.overall === 'fail') fail(`pipeline-health overall=fail (fail=${ph.totals?.fail})`);
  else if (ph.overall === 'warn') warn(`pipeline-health overall=warn`);
  else ok(`pipeline-health overall=${ph.overall}`);
  if (ph.latestWeek && ph.latestWeek !== WEEK) {
    warn(`pipeline-health latestWeek=${ph.latestWeek} vs gate week=${WEEK}`);
  }
}

const auditPath = path.join(weekDir, 'methodology-audit.json');
if (!fs.existsSync(auditPath)) {
  fail(`Missing ${WEEK}/methodology-audit.json — run audit-methodology-week.cjs ${WEEK}`);
} else {
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  if ((audit.fail || 0) > 0) fail(`methodology audit FAIL count=${audit.fail}`);
  else ok(`methodology audit pass=${audit.pass} warn=${audit.warn}`);
}

const venueOk = [];
for (const venue of REQUIRED) {
  const kitchen = path.join(weekDir, `kitchen-timing-${venue}.json`);
  const processed = path.join(ROOT, `${venue}-data-${WEEK}.json`);
  if (!fs.existsSync(kitchen)) {
    fail(`${venue}: missing kitchen-timing`);
    continue;
  }
  if (!fs.existsSync(processed)) {
    fail(`${venue}: missing processed ${venue}-data-${WEEK}.json`);
    continue;
  }
  let d;
  try {
    d = JSON.parse(fs.readFileSync(processed, 'utf8'));
  } catch (e) {
    fail(`${venue}: invalid JSON (${e.message})`);
    continue;
  }
  const stations = (d.stations || []).length;
  const curve = (d.curve || []).length;
  if (!stations || !curve) {
    fail(`${venue}: empty stations/curve`);
    continue;
  }
  const byFamily = (d.staffing && d.staffing.byFamily) || {};
  const fams = Object.keys(byFamily);
  if (!fams.length) {
    fail(`${venue}: missing staffing.byFamily`);
    continue;
  }
  const matchRate = Number(d.staffing?.matchStats?.bohMatchRate ?? d.staffing?.matchStats?.matchRate ?? 1);
  const laborSrc = d.staffing?.laborSource || d.staffing?.source || '';
  const weakLabor = matchRate < 0.2 || /toast_fallback/i.test(String(laborSrc));
  for (const [f, fam] of Object.entries(byFamily)) {
    const ipsh = fam.weekItemsPerStaffHour;
    if (ipsh == null || !(ipsh > 0)) continue;
    // Expo is pass-through volume — items/staff-hr is not a staffing signal
    if (/^expo$/i.test(String(f))) continue;
    if (ipsh >= IPSH_FAIL) {
      if (weakLabor) {
        warn(`${venue} ${f}: items/staff-hr=${ipsh} exceeds ${IPSH_FAIL} but labor match is weak (${(matchRate * 100).toFixed(0)}% / ${laborSrc || 'unknown'}) — kitchen metrics still publish; refresh Harri timesheets`);
      } else {
        fail(`${venue} ${f}: items/staff-hr=${ipsh} exceeds hard cap ${IPSH_FAIL} (likely bad labor join)`);
      }
    } else if (ipsh >= IPSH_WARN) {
      warn(`${venue} ${f}: items/staff-hr=${ipsh} is unusually high (review before exec share)`);
    }
  }
  venueOk.push(venue);
  ok(`${venue}: stations=${stations} families=${fams.length}`);
}

if (venueOk.length < REQUIRED.length) {
  fail(`Only ${venueOk.length}/${REQUIRED.length} venues exec-ready`);
} else {
  ok(`All ${REQUIRED.length} venues exec-ready`);
}

const stamp = {
  week: WEEK,
  generatedAt: new Date().toISOString(),
  ready: fails.length === 0,
  fails,
  warns,
  venues: venueOk,
};
fs.writeFileSync(path.join(weekDir, 'exec-publish-gate.json'), JSON.stringify(stamp, null, 2));
fs.writeFileSync(path.join(ROOT, 'exec-publish-gate.json'), JSON.stringify(stamp, null, 2));

console.log(`\nResult: ${stamp.ready ? 'READY TO PUBLISH' : 'BLOCKED'} · fails=${fails.length} warns=${warns.length}\n`);
process.exit(fails.length ? 1 : 0);
