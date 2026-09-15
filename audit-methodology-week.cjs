/**
 * Bulletproof W37 methodology audit:
 * Toast kitchen → processed week → labor (Toast|Harri) → FTE → staffing join → dashboard fields
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { HARRI_LABOR_VENUES, STAFFING_VENUES } = require('./boh-staffing-shared.cjs');

const ROOT = __dirname;
const WEEK = process.argv[2] || '2026-W37';
const findings = [];

function add(severity, area, venue, detail, evidence) {
  findings.push({ severity, area, venue: venue || '—', detail, evidence: evidence || '' });
}

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function isoWeekDates(weekLabel) {
  const m = String(weekLabel).match(/^(\d{4})-W(\d{2})$/);
  const year = +m[1], week = +m[2];
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

const dates = isoWeekDates(WEEK);
const weekDir = path.join(ROOT, 'data', WEEK);
const ph = loadJson(path.join(ROOT, 'pipeline-health.json'));
const venueRows = [];

console.log(`\n=== BOH methodology audit · ${WEEK} (${dates[0]} → ${dates[6]}) ===\n`);

// Pipeline health overall
if (!ph) add('fail', 'pipeline', null, 'pipeline-health.json missing');
else {
  const overall = ph.overall || ph.status;
  if (overall !== 'pass') add('warn', 'pipeline', null, `pipeline overall=${overall}`, JSON.stringify({ pass: ph.passCount, warn: ph.warnCount, fail: ph.failCount }));
  else add('pass', 'pipeline', null, 'pipeline-health overall=pass');
}

for (const venue of STAFFING_VENUES) {
  const kt = loadJson(path.join(weekDir, `kitchen-timing-${venue}.json`));
  const items = loadJson(path.join(weekDir, `item-details-${venue}.json`));
  const labor = loadJson(path.join(weekDir, `labor-${venue}.json`));
  const staffing = loadJson(path.join(weekDir, `staffing-${venue}.json`));
  const week = loadJson(path.join(ROOT, `${venue}-data-${WEEK}.json`));
  const isHarri = HARRI_LABOR_VENUES.includes(venue);

  // 1) Kitchen timing present + tickets
  const ktTickets = Array.isArray(kt) ? kt.length : (kt?.tickets?.length || kt?.rows || 0);
  if (!kt || !ktTickets) add('fail', 'kitchen', venue, 'Missing/empty kitchen-timing');
  else add('pass', 'kitchen', venue, `kitchen-timing rows=${ktTickets}`);

  // 2) Item details
  const itemRows = Array.isArray(items) ? items.length : (items?.items?.length || 0);
  if (!itemRows) add('warn', 'items', venue, 'Missing/empty item-details');
  else add('pass', 'items', venue, `item-details rows=${itemRows}`);

  // 3) Processed week JSON
  if (!week) {
    add('fail', 'processed', venue, `Missing ${venue}-data-${WEEK}.json`);
    venueRows.push({ venue, ok: false });
    continue;
  }
  const stations = week.stations || [];
  const foodTickets = stations.reduce((s, x) => s + (x.count || 0), 0);
  if (foodTickets < 100) add('warn', 'processed', venue, `Low food ticket volume=${foodTickets}`);
  else add('pass', 'processed', venue, `stations=${stations.length} foodTickets=${foodTickets}`);

  // 4) Labor source methodology
  if (!labor || !(labor.entryCount > 0)) {
    add('fail', 'labor', venue, 'Missing labor file / zero entries');
  } else {
    const src = labor.source || 'toast';
    if (isHarri && src !== 'harri') {
      add('fail', 'labor', venue, `Expected Harri labor, got source=${src}`);
    } else if (!isHarri && src === 'harri') {
      add('warn', 'labor', venue, `Non-Harri venue using Harri labor source`);
    } else {
      add('pass', 'labor', venue, `source=${src} entries=${labor.entryCount}`);
    }
    // Date coverage Mon–Sun
    const byDay = {};
    for (const e of labor.entries || []) {
      byDay[e.date] = (byDay[e.date] || 0) + 1;
    }
    const missingDays = dates.filter((d) => !byDay[d]);
    if (missingDays.length) add('warn', 'labor', venue, `No punches on ${missingDays.join(', ')}`);
    else add('pass', 'labor', venue, 'Punches present all 7 days');

    // Hours sanity
    const hours = (labor.entries || []).reduce((s, e) => s + (e.hours || 0), 0);
    if (hours < 50) add('warn', 'labor', venue, `Very low total hours=${hours.toFixed(1)}`);
    else add('pass', 'labor', venue, `totalHours=${hours.toFixed(1)}`);

    // inDate/outDate for concurrent staffing
    const withPunch = (labor.entries || []).filter((e) => e.inDate && e.outDate).length;
    const pct = labor.entryCount ? withPunch / labor.entryCount : 0;
    if (pct < 0.9) add('warn', 'labor', venue, `Only ${(pct * 100).toFixed(0)}% entries have in/out punches`);
    else add('pass', 'labor', venue, `${(pct * 100).toFixed(0)}% entries have in/out for hourly overlap`);
  }

  // 5) Staffing join
  if (!staffing && !(week.staffing && week.staffing.byFamily)) {
    add('fail', 'staffing', venue, 'No staffing join output');
  } else {
    const byFamily = (week.staffing && week.staffing.byFamily) || (staffing && staffing.byFamily) || {};
    const fams = Object.keys(byFamily);
    const withVol = fams.filter((f) => (byFamily[f].weekItemCount || 0) > 0);
    const withIpsh = fams.filter((f) => (byFamily[f].weekItemsPerStaffHour || 0) > 0);
    const ms = (week.staffing && week.staffing.matchStats) || (staffing && staffing.matchStats) || {};
    const boh = ms.bohMatchRate != null ? ms.bohMatchRate : null;

    if (!fams.length) add('fail', 'staffing', venue, 'byFamily empty');
    else add('pass', 'staffing', venue, `families=${fams.length} withVolume=${withVol.length} withIpsh=${withIpsh.length}`);

    if (boh == null) add('warn', 'staffing', venue, 'No bohMatchRate');
    else if (boh < 0.85) add('fail', 'staffing', venue, `bohMatchRate=${(boh * 100).toFixed(1)}% below 85%`);
    else if (boh < 0.95) add('warn', 'staffing', venue, `bohMatchRate=${(boh * 100).toFixed(1)}% (acceptable but soft)`);
    else add('pass', 'staffing', venue, `bohMatchRate=${(boh * 100).toFixed(1)}%`);

    // Methodology: ipsh = volume/hours on days with both
    let ipshOk = 0, ipshBad = 0, sample = null;
    for (const f of fams) {
      const days = byFamily[f].days || {};
      for (const day of Object.keys(days)) {
        const c = days[day];
        if (c && c.hours > 0 && c.volume > 0 && c.itemsPerStaffHour != null) {
          const expect = +(c.volume / c.hours).toFixed(2);
          if (Math.abs(expect - c.itemsPerStaffHour) <= 0.02) ipshOk++;
          else {
            ipshBad++;
            if (!sample) sample = { f, day, expect, got: c.itemsPerStaffHour, vol: c.volume, hours: c.hours };
          }
        }
      }
    }
    if (ipshBad) add('fail', 'methodology', venue, `ipsh ≠ volume/hours on ${ipshBad} day-cells`, JSON.stringify(sample));
    else if (ipshOk) add('pass', 'methodology', venue, `ipsh=volume/hours verified on ${ipshOk} day-cells`);
    else add('warn', 'methodology', venue, 'No day-cells with hours+volume to verify ipsh');

    venueRows.push({
      venue,
      laborSource: labor?.source || (isHarri ? 'MISSING' : 'toast'),
      laborEntries: labor?.entryCount || 0,
      foodTickets,
      families: fams.length,
      withIpsh: withIpsh.length,
      bohMatch: boh != null ? Math.round(boh * 100) : null,
      rosterCoverage: ms.rosterCoverage != null ? Math.round(ms.rosterCoverage * 100) : null,
    });
  }

  // 6) Dashboard embed: latest shell should include this week key in known weeks / embedded
  // (light check — file exists and has staffing)
  if (week.staffing?.byFamily) add('pass', 'dashboard-ready', venue, 'week JSON has staffing.byFamily for Pages/Firebase');
}

// Cross-venue portfolio readiness
const portfolioReady = venueRows.filter((v) => v.withIpsh > 0);
if (portfolioReady.length < 5) {
  add('warn', 'portfolio', null, `Only ${portfolioReady.length}/5 venues have items/staff-hr families for compare`);
} else {
  add('pass', 'portfolio', null, 'All 5 venues have items/staff-hr families for RDG Portfolio Stations');
}

// FTE roster
const fte = loadJson(path.join(ROOT, 'data', 'fte', `fte-roster-${WEEK}.json`));
if (!fte) add('warn', 'fte', null, `Missing fte-roster-${WEEK}.json`);
else {
  const n = (fte.roster || fte.people || fte.rows || []).length || Object.keys(fte.byVenue || {}).length;
  add('pass', 'fte', null, `FTE roster present (${n || 'ok'})`);
}

const summary = {
  week: WEEK,
  range: `${dates[0]} → ${dates[6]}`,
  pass: findings.filter((f) => f.severity === 'pass').length,
  warn: findings.filter((f) => f.severity === 'warn').length,
  fail: findings.filter((f) => f.severity === 'fail').length,
  venues: venueRows,
  findings,
  methodology: [
    'Kitchen timing (Toast) → food-station filter → week metrics',
    'Labor: Toast Partner API for MILA/AVA WP; Harri CSV for Claudie/AVA CG/Casa Neos',
    'FTE roster (Viktor) → name match → station family',
    'items/staff-hr = day volume ÷ concurrent staff hours (punch overlap)',
    'Harri lounge brands excluded from kitchen labor',
  ],
};

const out = path.join(ROOT, 'data', WEEK, 'methodology-audit.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ pass: summary.pass, warn: summary.warn, fail: summary.fail, venues: venueRows }, null, 2));
console.log('\nFindings:');
for (const f of findings) {
  const icon = f.severity === 'pass' ? 'PASS' : f.severity === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${icon}] ${f.area}/${f.venue}: ${f.detail}`);
}
console.log('\nWrote', out);
process.exit(summary.fail > 0 ? 1 : 0);
