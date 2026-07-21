'use strict';
/**
 * Pipeline health / sanity check for BOH Dashboard.
 * Writes pipeline-health.json consumed by the Settings tab.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const DATA_ROOT = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'pipeline-health.json');

const VENUES = [
  { slug: 'claudie', label: 'Claudie' },
  { slug: 'casa_neos', label: 'Casa Neos' },
  { slug: 'ava_coconut_grove', label: 'AVA Coconut Grove' },
  { slug: 'ava_winter_park', label: 'AVA Winter Park' },
  { slug: 'mila', label: 'MILA' },
];

function fileMeta(p, arrayKey) {
  if (!fs.existsSync(p)) return null;
  const st = fs.statSync(p);
  let rows = null;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(j)) rows = j.length;
    else if (j && arrayKey && Array.isArray(j[arrayKey])) rows = j[arrayKey].length;
    else if (j && Array.isArray(j.tickets)) rows = j.tickets.length;
    else if (j && Array.isArray(j.covers)) rows = j.covers.length;
    else if (j && Array.isArray(j.items)) rows = j.items.length;
    else if (j && Array.isArray(j.stations)) rows = j.stations.length;
    else if (j && typeof j === 'object') rows = Object.keys(j).length;
  } catch (_) {}
  return { path: p, mtime: st.mtime.toISOString(), size: st.size, rows };
}

function latestWeekDirs() {
  if (!fs.existsSync(DATA_ROOT)) return [];
  return fs.readdirSync(DATA_ROOT)
    .filter(d => /^\d{4}-W\d{2}$/.test(d))
    .sort()
    .reverse();
}

function getScheduleInfo() {
  try {
    const out = execSync('schtasks /query /tn "BOH Dashboard Weekly Fetch" /fo LIST /v', { encoding: 'utf8' });
    const get = (label) => {
      const m = out.match(new RegExp(label + ':\\s*(.+)', 'i'));
      return m ? m[1].trim() : null;
    };
    return {
      exists: true,
      status: get('Status'),
      nextRun: get('Next Run Time'),
      lastRun: get('Last Run Time'),
      lastResult: get('Last Result'),
      startTime: get('Start Time'),
      days: get('Days'),
      scheduleType: get('Schedule Type'),
      taskToRun: get('Task To Run'),
    };
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

function getMonthlyPrepScheduleInfo() {
  try {
    const out = execSync('schtasks /query /tn "BOH Dashboard Monthly Prep Stations" /fo LIST /v', { encoding: 'utf8' });
    const get = (label) => {
      const m = out.match(new RegExp(label + ':\\s*(.+)', 'i'));
      return m ? m[1].trim() : null;
    };
    return {
      exists: true,
      status: get('Status'),
      nextRun: get('Next Run Time'),
      lastRun: get('Last Run Time'),
      lastResult: get('Last Result'),
      startTime: get('Start Time'),
      days: get('Days'),
      months: get('Months'),
      scheduleType: get('Schedule Type'),
      taskToRun: get('Task To Run'),
    };
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

function checkVenueWeek(slug, week) {
  const weekDir = path.join(DATA_ROOT, week);
  const checks = [];

  const kitchen = fileMeta(path.join(weekDir, `kitchen-timing-${slug}.json`), 'tickets');
  const covers = fileMeta(path.join(weekDir, `covers-${slug}.json`), 'covers');
  const itemDetails = fileMeta(path.join(weekDir, `item-details-${slug}.json`), 'items');
  const itemFul = fileMeta(path.join(weekDir, `item-fulfillment-${slug}.json`), 'items');
  const processed = fileMeta(path.join(ROOT, `${slug}-data-${week}.json`), 'stations');

  // Toast kitchen timing
  if (!kitchen) {
    checks.push({ id: 'toast_kitchen', source: 'Toast', label: 'Kitchen Timing', status: 'fail', message: 'Missing kitchen-timing file' });
  } else if ((kitchen.rows || 0) < 100) {
    checks.push({ id: 'toast_kitchen', source: 'Toast', label: 'Kitchen Timing', status: 'warn', message: `Only ${kitchen.rows} rows (expected 100+)`, meta: kitchen });
  } else {
    checks.push({ id: 'toast_kitchen', source: 'Toast', label: 'Kitchen Timing', status: 'pass', message: `${kitchen.rows.toLocaleString()} tickets`, meta: kitchen });
  }

  // Item details
  if (!itemDetails) {
    checks.push({ id: 'toast_items', source: 'Toast', label: 'Item Details', status: 'fail', message: 'Missing item-details file' });
  } else if ((itemDetails.rows || 0) < 50) {
    checks.push({ id: 'toast_items', source: 'Toast', label: 'Item Details', status: 'warn', message: `Only ${itemDetails.rows} items`, meta: itemDetails });
  } else {
    checks.push({ id: 'toast_items', source: 'Toast', label: 'Item Details', status: 'pass', message: `${itemDetails.rows.toLocaleString()} item rows`, meta: itemDetails });
  }

  // Item fulfillment custom report
  if (!itemFul) {
    checks.push({ id: 'toast_fulfillment', source: 'Toast', label: 'Item Fulfillment Report', status: 'warn', message: 'Missing item-fulfillment file' });
  } else {
    checks.push({ id: 'toast_fulfillment', source: 'Toast', label: 'Item Fulfillment Report', status: 'pass', message: `${(itemFul.rows || 0).toLocaleString()} items`, meta: itemFul });
  }

  // OpenTable covers
  if (!covers) {
    checks.push({ id: 'ot_covers', source: 'OpenTable', label: 'Covers Export', status: 'fail', message: 'Missing covers file' });
  } else if ((covers.rows || 0) < 10) {
    checks.push({ id: 'ot_covers', source: 'OpenTable', label: 'Covers Export', status: 'warn', message: `Only ${covers.rows} covers`, meta: covers });
  } else {
    checks.push({ id: 'ot_covers', source: 'OpenTable', label: 'Covers Export', status: 'pass', message: `${covers.rows.toLocaleString()} covers`, meta: covers });
  }

  // Processed dashboard data
  if (!processed) {
    checks.push({ id: 'processed', source: 'Pipeline', label: 'Processed Venue JSON', status: 'fail', message: 'Missing processed data file' });
  } else {
    let bp = null, stations = 0, curve = 0;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, `${slug}-data-${week}.json`), 'utf8'));
      bp = d.breakingPoint;
      stations = (d.stations || []).length;
      curve = (d.curve || []).length;
    } catch (_) {}
    if (stations === 0 || curve === 0) {
      checks.push({ id: 'processed', source: 'Pipeline', label: 'Processed Venue JSON', status: 'fail', message: `Empty data (stations=${stations}, curve=${curve})`, meta: processed });
    } else {
      checks.push({ id: 'processed', source: 'Pipeline', label: 'Processed Venue JSON', status: 'pass', message: `${stations} stations, curve=${curve}, BP=${bp ?? 'none'}`, meta: processed });
    }
  }

  const fail = checks.filter(c => c.status === 'fail').length;
  const warn = checks.filter(c => c.status === 'warn').length;
  const pass = checks.filter(c => c.status === 'pass').length;
  return { slug, checks, summary: { pass, warn, fail }, overall: fail ? 'fail' : (warn ? 'warn' : 'pass') };
}

const weeks = latestWeekDirs();
const latestWeek = weeks[0] || null;
const schedule = getScheduleInfo();
const monthlyPrepSchedule = getMonthlyPrepScheduleInfo();

const prepStationFiles = ['claudie', 'ava_cg', 'ava_wp', 'casa_neos'].map(v => ({
  venue: v,
  ...fileMeta(path.join(DATA_ROOT, `prep-stations-${v}.json`), 'items'),
}));

const venueResults = latestWeek
  ? VENUES.map(v => ({ ...v, ...checkVenueWeek(v.slug, latestWeek) }))
  : [];

const dashboardHtml = fileMeta(path.join(ROOT, 'dashboard.html'));
const rolling = fileMeta(path.join(DATA_ROOT, 'rolling.json'));
const sessionToast = fileMeta(path.join(ROOT, 'toast-session.json'));
const sessionOT = fileMeta(path.join(ROOT, 'ot-session.json'));
const itemStationMap = fileMeta(path.join(ROOT, 'item-station-map.json'));

const totals = venueResults.reduce((a, v) => {
  a.pass += v.summary.pass; a.warn += v.summary.warn; a.fail += v.summary.fail;
  return a;
}, { pass: 0, warn: 0, fail: 0 });

const pipelineSteps = [
  { step: 1, name: 'Refresh Toast session', how: 'intercept.js (Playwright login)', when: 'Monday 8:30 AM' },
  { step: 2, name: 'Fetch Toast Kitchen Timing', how: 'weekly-save.js → kitchen-timing-{venue}.json', when: 'Monday 8:30 AM' },
  { step: 3, name: 'Fetch Toast Item Details', how: 'weekly-save.js → item-details-{venue}.json', when: 'Monday 8:30 AM' },
  { step: 4, name: 'Fetch Toast Item Fulfillment', how: 'weekly-save.js → item-fulfillment-{venue}.json', when: 'Monday 8:30 AM' },
  { step: 5, name: 'Fetch OpenTable Covers', how: 'weekly-save.js → covers-{venue}.json', when: 'Monday 8:30 AM' },
  { step: 6, name: 'Process venue metrics', how: 'process-venue-data.cjs per venue', when: 'Monday 8:30 AM' },
  { step: 7, name: 'Rebuild dashboard.html', how: 'build-unified-v2.cjs', when: 'Monday 8:30 AM' },
  { step: 8, name: 'Sanity check + push GitHub Pages', how: 'pipeline-health.cjs + git push', when: 'Monday 8:30 AM' },
];

const monthlyPrepSteps = [
  { step: 1, name: 'Refresh Toast session', how: 'intercept.js', when: '1st of month 9:00 AM' },
  { step: 2, name: 'Scrape prep stations (all venues)', how: 'scrape-prep-stations-all.cjs', when: '1st of month 9:00 AM' },
  { step: 3, name: 'Merge REF + Toast stations', how: 'extract-item-stations.cjs', when: '1st of month 9:00 AM' },
  { step: 4, name: 'Rebuild dashboard + push', how: 'build-unified-v2.cjs + git push', when: '1st of month 9:00 AM' },
];

const health = {
  generatedAt: new Date().toISOString(),
  latestWeek,
  availableWeeks: weeks,
  schedule: {
    ...schedule,
    expected: { day: 'Monday', time: '08:30', timezone: 'local' },
    matchesExpected: !!(schedule.exists && /MON/i.test(schedule.days || '') && /8:30/i.test(schedule.startTime || '')),
  },
  monthlyPrepSchedule: {
    ...monthlyPrepSchedule,
    expected: { day: '1st', time: '09:00', timezone: 'local' },
    matchesExpected: !!(monthlyPrepSchedule.exists && /every month/i.test(monthlyPrepSchedule.months || '') && /9:00/i.test(monthlyPrepSchedule.startTime || '')),
  },
  prepStationFiles,
  files: {
    dashboardHtml,
    rolling,
    sessionToast,
    sessionOT,
    itemStationMap,
  },
  venues: venueResults,
  totals,
  overall: totals.fail ? 'fail' : (totals.warn ? 'warn' : 'pass'),
  pipelineSteps,
  monthlyPrepSteps,
};

fs.writeFileSync(OUT, JSON.stringify(health, null, 2));
console.log(`✅ Written ${OUT}`);
console.log(`Week: ${latestWeek} | PASS ${totals.pass} WARN ${totals.warn} FAIL ${totals.fail} | overall=${health.overall}`);
console.log(`Schedule: ${schedule.exists ? `${schedule.days} ${schedule.startTime} (next ${schedule.nextRun})` : 'NOT FOUND'}`);
console.log(`Matches Monday 8:30: ${health.schedule.matchesExpected}`);
