'use strict';
const fs = require('fs');
const path = require('path');

const venueArg = process.argv[2];
if (!venueArg) { console.error('Usage: node process-venue-data.cjs <venue_slug>'); process.exit(1); }

// Load authoritative item assignments + targets (REF, then chef overrides).
let ITEM_ASSIGNMENTS = {};
try {
  const mapPath = path.join(__dirname, 'item-station-map.json');
  const allAssignments = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const keyMap = { claudie: 'claudie', casa_neos: 'casa_neos', casaneos: 'casa_neos', ava_coconut_grove: 'ava_cg', ava_winter_park: 'ava_wp', mila: 'mila' };
  const configKey = keyMap[venueArg] || venueArg;
  ITEM_ASSIGNMENTS = allAssignments[configKey] || {};
} catch(e) { /* item assignment file optional */ }

// Use explicit week arg (e.g. 2026-W28) or auto-detect latest week directory
const weekArg = process.argv[3];
let weekDir;
if (weekArg) {
  weekDir = weekArg;
} else {
  const dataRoot = path.join(__dirname, 'data');
  const entries = fs.readdirSync(dataRoot)
    .filter(d => /^\d{4}-W\d{2}$/.test(d))
    .sort();
  if (!entries.length) { console.error('No week directories found in data/'); process.exit(1); }
  weekDir = entries[entries.length - 1];
  console.log(`Auto-detected week: ${weekDir}`);
}
const DATA_DIR = path.join(__dirname, 'data', weekDir);
const ktPath = path.join(DATA_DIR, `kitchen-timing-${venueArg}.json`);
const coversPath = path.join(DATA_DIR, `covers-${venueArg}.json`);

const ktRaw = JSON.parse(fs.readFileSync(ktPath, 'utf8'));
let coversRaw = { covers: [] };
if (fs.existsSync(coversPath)) {
  coversRaw = JSON.parse(fs.readFileSync(coversPath, 'utf8'));
} else {
  console.warn(`No covers file for ${venueArg} (${weekDir}) — continuing with empty covers`);
}

const tickets = ktRaw.tickets || ktRaw;
const covers = coversRaw.covers || coversRaw || [];

// Load item details if available
const itemDetailsPath = path.join(DATA_DIR, `item-details-${venueArg}.json`);
let itemDetails = [];
if (fs.existsSync(itemDetailsPath)) {
  try {
    const idRaw = JSON.parse(fs.readFileSync(itemDetailsPath, 'utf8'));
    itemDetails = idRaw.items || [];
    console.log(`Item details for ${venueArg}: ${itemDetails.length} rows`);
  } catch(e) { console.warn('Could not load item details:', e.message); }
} else {
  console.log(`No item-details-${venueArg}.json found, skipping menu item volumes`);
}

// ---- Station filter ----
const EXCLUDE_WORDS = [
  'bar', 'champagne', 'wine', 'btg', 'pos', 'barista', 'somm', 'water', 'service', 'beach', 'drink',
  'no print', 'noprint', 'all in', 'package', 'deposit', 'beo', 'gift card', 'gratuity',
  'host', 'runner', 'server', 'captain', 'busser', 'bartender', 'sommelier',
];
function isFood(name) {
  if (!name) return false;
  const low = name.toLowerCase();
  return !EXCLUDE_WORDS.some(w => low.includes(w));
}

// ---- Parse fulfillment time ----
function parseFulTime(str) {
  if (!str) return null;
  const mMatch = str.match(/(\d+)\s*minute/);
  const sMatch = str.match(/(\d+)\s*second/);
  const m = mMatch ? parseInt(mMatch[1]) : 0;
  const s = sMatch ? parseInt(sMatch[1]) : 0;
  return m * 60 + s;
}

// ---- Parse date string from ticket ----
function parseDate(str) {
  if (!str) return null;
  // Format: "6/29/26 5:48 PM"
  try {
    const d = new Date(str.replace(/(\d+)\/(\d+)\/(\d+)/, (_, m, d, y) => `20${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`));
    return isNaN(d) ? null : d;
  } catch(e) { return null; }
}

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Calibration: Toast fulfillment times run ~5s high vs observed service — subtract from all actuals
const FULFILLMENT_ADJUST_SEC = 5;
function adjustFulSec(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return sec;
  return Math.max(0, Number(sec) - FULFILLMENT_ADJUST_SEC);
}

// Max realistic BOH cook time — longer rows are usually unclosed / orphaned noise
const MAX_FUL_SEC = 90 * 60;

// ---- Filter food tickets (closed + food stations only) ----
let skippedOpen = 0;
let skippedLong = 0;
let skippedNonFood = 0;
const foodTickets = tickets.filter(t => {
  if (!isFood(t['Station'])) { skippedNonFood++; return false; }
  const fired = parseDate(t['Fired Date']);
  const fulSecRaw = parseFulTime(t['Fulfillment Time']);
  const fulSec = adjustFulSec(fulSecRaw);
  const fulfilledAt = parseDate(t['Fulfilled Date']);
  // Must be closed: need fulfillment duration and a fulfilled timestamp
  if (!fired || fulSecRaw == null || fulSecRaw <= 0) { skippedOpen++; return false; }
  if (!fulfilledAt && !t['Fulfilled Date']) { skippedOpen++; return false; }
  if (fulSecRaw > MAX_FUL_SEC) { skippedLong++; return false; }
  return true;
}).map(t => {
  const fired = parseDate(t['Fired Date']);
  const fulSec = adjustFulSec(parseFulTime(t['Fulfillment Time']));
  const fulfilled = fired && fulSec != null ? new Date(fired.getTime() + fulSec * 1000) : null;
  return { ...t, _fired: fired, _fulfilled: fulfilled, _fulSec: fulSec };
}).filter(t => t._fired && t._fulSec != null && t._fulfilled);

console.log(`Food tickets for ${venueArg}: ${foodTickets.length} (skipped non-food=${skippedNonFood}, open/unclosed=${skippedOpen}, >90min=${skippedLong}; ful −${FULFILLMENT_ADJUST_SEC}s)`);

// ---- workloadDayHourly ----
// For each ticket, assign to day+hour of the fired date
const dayHourMap = {}; // {day: {hr: {sumFul, count}}}
foodTickets.forEach(t => {
  const day = DAYS[t._fired.getDay()];
  const hr = t._fired.getHours();
  const hrKey = `${hr}-${hr+1}`;
  if (!dayHourMap[day]) dayHourMap[day] = {};
  if (!dayHourMap[day][hrKey]) dayHourMap[day][hrKey] = { sumFul: 0, count: 0 };
  dayHourMap[day][hrKey].sumFul += t._fulSec / 60;
  dayHourMap[day][hrKey].count++;
});

const workloadDayHourly = [];
Object.keys(dayHourMap).forEach(day => {
  Object.keys(dayHourMap[day]).forEach(hrKey => {
    const d = dayHourMap[day][hrKey];
    workloadDayHourly.push({
      Day: day,
      'Hour Window': hrKey,
      avg_fulfillment_min: +(d.sumFul / d.count).toFixed(2),
      occurrences: d.count,
    });
  });
});

// Build hmFul for dashboard
const hmFul = {};
workloadDayHourly.forEach(r => {
  if (!hmFul[r.Day]) hmFul[r.Day] = {};
  hmFul[r.Day][r['Hour Window']] = r.avg_fulfillment_min;
});

// Hour-of-day profile (10am → 4am): avg occurrences + avg fulfillment across days
const SERVICE_HOURS = [10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3];
const hourProfile = SERVICE_HOURS.map(hr => {
  const hrKey = `${hr}-${hr + 1}`;
  let sumOcc = 0, sumFulWeighted = 0, daysWithData = 0;
  Object.keys(dayHourMap).forEach(day => {
    const cell = dayHourMap[day][hrKey];
    if (!cell || !cell.count) return;
    sumOcc += cell.count;
    sumFulWeighted += cell.sumFul; // already in minutes * count
    daysWithData++;
  });
  return {
    hour: hrKey,
    label: hr === 0 ? '12a' : hr < 12 ? hr + 'a' : hr === 12 ? '12p' : (hr - 12) + 'p',
    avgOcc: daysWithData ? +(sumOcc / daysWithData).toFixed(1) : 0,
    avgFulMin: sumOcc ? +(sumFulWeighted / sumOcc).toFixed(2) : null,
    days: daysWithData,
    totalOcc: sumOcc,
  };
});

// ---- covers -> concurrent guests per minute ----
// Parse covers
const parsedCovers = covers.map(c => ({
  seated: new Date(c.seatedTime),
  finished: new Date(c.finishedTime),
  size: c.partySize || 1,
})).filter(c => {
  if (isNaN(c.seated) || isNaN(c.finished)) return false;
  const dur = c.finished - c.seated;
  return dur > 0 && dur < 12 * 3600 * 1000; // max 12-hour stay
});

function concurrentGuestsAt(ts) {
  return parsedCovers.filter(c => c.seated <= ts && c.finished >= ts).reduce((s, c) => s + c.size, 0);
}

// ---- otDayHourly ----
// For each day+hour bucket, compute avg concurrent guests (sample at half-hour mark)
const otDayHourlyMap = {};
parsedCovers.forEach(c => {
  // scan hour buckets that overlap with this cover
  const startHr = Math.floor(c.seated.getTime() / 3600000) * 3600000;
  const endHr = Math.floor(c.finished.getTime() / 3600000) * 3600000;
  for (let t = startHr; t <= endHr; t += 3600000) {
    const dt = new Date(t);
    const day = DAYS[dt.getDay()];
    const hr = dt.getHours();
    const hrKey = `${hr}-${hr+1}`;
    const key = `${day}|${hrKey}`;
    if (!otDayHourlyMap[key]) otDayHourlyMap[key] = { day, hrKey, samples: [] };
  }
});
// Now sample concurrent guests at each hour bucket midpoint
const uniqueHourBuckets = new Set();
parsedCovers.forEach(c => {
  const startHr = Math.floor(c.seated.getTime() / 3600000);
  const endHr = Math.floor(c.finished.getTime() / 3600000);
  for (let h = startHr; h <= endHr; h++) {
    uniqueHourBuckets.add(h);
  }
});

const hmGuests = {};
uniqueHourBuckets.forEach(h => {
  const midTs = new Date((h * 3600 + 1800) * 1000);
  const concurrent = concurrentGuestsAt(midTs);
  if (concurrent === 0) return;
  const day = DAYS[midTs.getDay()];
  const hr = midTs.getHours();
  const hrKey = `${hr}-${hr+1}`;
  if (!hmGuests[day]) hmGuests[day] = {};
  if (!hmGuests[day][hrKey]) hmGuests[day][hrKey] = { sum: 0, count: 0 };
  hmGuests[day][hrKey].sum += concurrent;
  hmGuests[day][hrKey].count++;
});
// Flatten
const hmGuestsFlat = {};
Object.keys(hmGuests).forEach(day => {
  hmGuestsFlat[day] = {};
  Object.keys(hmGuests[day]).forEach(hr => {
    const d = hmGuests[day][hr];
    hmGuestsFlat[day][hr] = +(d.sum / d.count).toFixed(1);
  });
});

// ---- workloadOverall using event-based intervals (matches Python algorithm) ----
// Merge multi-station rows into one logical order per (Check #, Fired Date).
// Toast fires the same check on Cold Expo, Hot Expo, Saute, etc. — each gets its own row.
// Counting those separately inflated concurrency (~93) and diluted avg fulfillment (~3 min).
function mergeOrderTickets(rows) {
  const groups = new Map();
  rows.forEach(t => {
    const key = `${t['Check #']}||${t['Fired Date']}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  return [...groups.values()].map(stationRows => {
    const fired = new Date(Math.min(...stationRows.map(r => r._fired.getTime())));
    const fulfilled = new Date(Math.max(...stationRows.map(r => r._fulfilled.getTime())));
    const fulSec = (fulfilled.getTime() - fired.getTime()) / 1000;
    return { ...stationRows[0], _fired: fired, _fulfilled: fulfilled, _fulSec: fulSec };
  });
}

const orderTickets = mergeOrderTickets(foodTickets);
console.log(`Order tickets (merged): ${orderTickets.length} from ${foodTickets.length} station fires`);

// Legacy alias — curve / breaking point / service-break use merged orders, not per-station rows
const uniqueTickets = orderTickets;

function weightedP75Min(entries) {
  if (!entries.length) return 0;
  const sorted = [...entries].sort((a, b) => a.val - b.val);
  const totalW = sorted.reduce((s, x) => s + x.weight, 0);
  if (totalW <= 0) return sorted[sorted.length - 1].val / 60;
  let cum = 0;
  for (const v of sorted) {
    cum += v.weight;
    if (cum >= totalW * 0.75) return v.val / 60;
  }
  return sorted[sorted.length - 1].val / 60;
}

// Step 2: Build duration-weighted interval curve
function buildIntervalCurve(ticketList) {
  const events = [];
  ticketList.forEach(t => {
    events.push({ time: t._fired.getTime(), type: 1, ticket: t });
    events.push({ time: t._fulfilled.getTime(), type: -1, ticket: t });
  });
  // sort: earlier first; on tie, closes before opens to avoid momentary phantom overlap
  events.sort((a, b) => a.time !== b.time ? a.time - b.time : a.type - b.type);

  const open = new Set();
  let prevTime = null;
  const intervals = [];

  events.forEach(ev => {
    if (prevTime !== null && ev.time > prevTime && open.size > 0) {
      const duration_sec = (ev.time - prevTime) / 1000;
      const fuls = [...open].map(t => t._fulSec);
      const avg_ful_sec = fuls.reduce((s, x) => s + x, 0) / fuls.length;
      const midTs = new Date((prevTime + ev.time) / 2);
      const guests = concurrentGuestsAt(midTs);
      intervals.push({ conc: open.size, duration_sec, avg_ful_sec, guests });
    }
    if (ev.type === 1) open.add(ev.ticket);
    else open.delete(ev.ticket);
    prevTime = ev.time;
  });

  // Group intervals by concurrent count
  const byConc = {};
  intervals.forEach(iv => {
    if (!byConc[iv.conc]) byConc[iv.conc] = [];
    byConc[iv.conc].push(iv);
  });

  return Object.entries(byConc).map(([k, ivs]) => {
    const totalDur = ivs.reduce((s, iv) => s + iv.duration_sec, 0);
    const ful_min = ivs.reduce((s, iv) => s + (iv.avg_ful_sec / 60) * iv.duration_sec, 0) / totalDur;
    const p75Entries = ivs.map(iv => ({ val: iv.avg_ful_sec, weight: iv.duration_sec }));
    const p75_min = weightedP75Min(p75Entries);
    const guestSum = ivs.reduce((s, iv) => s + iv.guests * iv.duration_sec, 0);
    const guests = totalDur > 0 ? guestSum / totalDur : 0;
    return {
      conc: +k,
      occ: ivs.length,
      ful: +ful_min.toFixed(2),
      p75: +p75_min.toFixed(2),
      guests: +guests.toFixed(1),
    };
  }).sort((a, b) => a.conc - b.conc);
}

const curve = buildIntervalCurve(uniqueTickets);

// Per-day pressure curves (same algorithm, tickets filtered by fired weekday)
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const curveByDay = { Total: curve };
DAY_ORDER.forEach(day => {
  const dayTickets = uniqueTickets.filter(t => DAYS[t._fired.getDay()] === day);
  curveByDay[day] = dayTickets.length ? buildIntervalCurve(dayTickets) : [];
});
console.log('curveByDay:', DAY_ORDER.map(d => `${d}(${curveByDay[d].length})`).join(', '));

// tbk: bucket curve by 10 concurrent tickets, weighted by duration (occ × ful proxy)
const tbkMap = {};
curve.forEach(r => {
  const bucket = Math.floor(r.conc / 10) * 10;
  const label = `${bucket}-${bucket+10}`;
  if (!tbkMap[label]) tbkMap[label] = { sumFul: 0, sumOcc: 0, low: bucket };
  tbkMap[label].sumFul += r.ful * r.occ;
  tbkMap[label].sumOcc += r.occ;
});
const tbk = Object.entries(tbkMap).sort((a,b) => a[1].low - b[1].low).map(([label, d]) => ({
  bucket: label,
  ful: d.sumOcc > 0 ? +(d.sumFul / d.sumOcc).toFixed(2) : 0,
}));

// Breaking point — skip first 10 load levels, require occ>=5 intervals, first crossing avg > 15 min
const breakingPointRow = curve.find((r, i) => i >= 10 && r.occ >= 5 && r.ful > 15);
const breakingPoint = breakingPointRow ? breakingPointRow.conc : null;
const breakingPointGuests = breakingPointRow ? Math.round(breakingPointRow.guests) : null;
console.log('Breaking point (intervals):', breakingPoint, '| guests:', breakingPointGuests);

// ---- Service break timeline (1-min samples of concurrent open tickets + avg ful) ----
// Answers: "When during this day's service did open-ticket avg ful exceed 15 min?"
const BREAK_THRESHOLD_MIN = 15;
const SERVICE_START_MIN = 10 * 60; // 10:00
const SERVICE_END_MIN = 28 * 60;   // 04:00 next day (as minutes from midnight)

function fmtClockMin(absMin) {
  const m = ((absMin % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ap = h < 12 ? 'a' : 'p';
  return h12 + ':' + String(mm).padStart(2, '0') + ap;
}

function buildDayMinuteTimeline(dayTickets) {
  if (!dayTickets.length) return null;

  // Build open-set events, then sample at each minute of service window
  const events = [];
  dayTickets.forEach(t => {
    if (!t._fulfilled) return;
    events.push({ time: t._fired.getTime(), type: 1, ticket: t });
    events.push({ time: t._fulfilled.getTime(), type: -1, ticket: t });
  });
  events.sort((a, b) => a.time !== b.time ? a.time - b.time : a.type - b.type);

  // Anchor calendar day from first fired ticket (local)
  const anchor = new Date(dayTickets[0]._fired.getTime());
  anchor.setHours(0, 0, 0, 0);
  const dayStartMs = anchor.getTime();

  const open = new Set();
  let ei = 0;
  const labels = [];
  const conc = [];
  const ful = [];
  let brokenMinutes = 0;
  let firstBreak = null;
  let peakConcWhileBroken = 0;
  let firstActive = -1;
  let lastActive = -1;

  for (let absMin = SERVICE_START_MIN; absMin < SERVICE_END_MIN; absMin++) {
    const sampleMs = dayStartMs + absMin * 60 * 1000;
    // Advance events up to sample instant (closes before opens on ties already sorted)
    while (ei < events.length && events[ei].time <= sampleMs) {
      const ev = events[ei++];
      if (ev.type === 1) open.add(ev.ticket);
      else open.delete(ev.ticket);
    }
    const n = open.size;
    let fulMin = null;
    if (n > 0) {
      let sum = 0;
      open.forEach(t => { sum += t._fulSec; });
      fulMin = +(sum / n / 60).toFixed(2);
      if (firstActive < 0) firstActive = labels.length;
      lastActive = labels.length;
    }
    const broken = fulMin != null && fulMin > BREAK_THRESHOLD_MIN;
    if (broken) {
      brokenMinutes++;
      if (!firstBreak) firstBreak = fmtClockMin(absMin);
      if (n > peakConcWhileBroken) peakConcWhileBroken = n;
    }
    labels.push(fmtClockMin(absMin));
    conc.push(n);
    ful.push(fulMin);
  }

  // Trim leading/trailing empty concurrency to keep payload smaller
  if (firstActive < 0) return null;
  const pad = 5;
  const lo = Math.max(0, firstActive - pad);
  const hi = Math.min(labels.length - 1, lastActive + pad) + 1;
  return {
    startMin: SERVICE_START_MIN + lo,
    labels: labels.slice(lo, hi),
    conc: conc.slice(lo, hi),
    ful: ful.slice(lo, hi),
    brokenMinutes,
    firstBreak,
    peakConcWhileBroken,
    ticketCount: dayTickets.length,
  };
}

const serviceBreakTimeline = { thresholdMin: BREAK_THRESHOLD_MIN, byDay: {} };
DAY_ORDER.forEach(day => {
  const dayTickets = uniqueTickets.filter(t => DAYS[t._fired.getDay()] === day && t._fulfilled);
  const series = buildDayMinuteTimeline(dayTickets);
  if (series) serviceBreakTimeline.byDay[day] = series;
});
const breakDaySummary = DAY_ORDER
  .filter(d => serviceBreakTimeline.byDay[d])
  .map(d => d + ':' + serviceBreakTimeline.byDay[d].brokenMinutes + 'm')
  .join(', ');
console.log('Service break timeline (broken mins):', breakDaySummary || 'none');

// ---- Stations ----
// A station target is the item-volume-weighted average of all targeted items
// assigned to that station for the selected week.
const itemVolume = {};
itemDetails.forEach(item => {
  if (!item.menuItem) return;
  itemVolume[item.menuItem] = (itemVolume[item.menuItem] || 0) + (item.qty || 1);
});

function stationNamesMatch(a, b) {
  const na = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nb = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na));
}

function deriveStationTarget(stationName) {
  let weighted = 0;
  let volume = 0;
  const fallbackTargets = [];
  Object.entries(ITEM_ASSIGNMENTS).forEach(([item, info]) => {
    if (!(info.stations || []).some(st => stationNamesMatch(st, stationName))) return;
    if (!(info.targetSec > 0)) return;
    fallbackTargets.push(info.targetSec);
    const qty = itemVolume[item] || 0;
    if (qty > 0) {
      weighted += info.targetSec * qty;
      volume += qty;
    }
  });
  if (volume > 0) return weighted / volume;
  return fallbackTargets.length
    ? fallbackTargets.reduce((sum, value) => sum + value, 0) / fallbackTargets.length
    : 0;
}

const derivedStationTargets = {};
const stationAgg = {};
foodTickets.forEach(t => {
  const st = t['Station'];
  if (!stationAgg[st]) stationAgg[st] = { count: 0, totalSec: 0 };
  stationAgg[st].count++;
  stationAgg[st].totalSec += t._fulSec;
});
const stations = Object.entries(stationAgg).map(([station, d]) => ({
  station,
  count: d.count,
  avg_sec: +(d.totalSec / d.count).toFixed(2),
  exp_sec: derivedStationTargets[station] = deriveStationTarget(station),
})).sort((a,b) => b.count - a.count);

// ---- Per-station breaking point using duration-weighted intervals ----
// For each station, collect its tickets (deduped within station) and build interval curve
const stationTicketsMap = {}; // station -> Set of unique ticket keys -> ticket
foodTickets.forEach(t => {
  const st = t['Station'];
  if (!st) return;
  if (!stationTicketsMap[st]) stationTicketsMap[st] = new Map();
  const key = `${t['Check #']}||${t['Fired Date']}||${t['Fulfillment Time']}`;
  if (!stationTicketsMap[st].has(key)) stationTicketsMap[st].set(key, t);
});

stations.forEach(stRow => {
  const st = stRow.station;
  const stTickets = stationTicketsMap[st] ? [...stationTicketsMap[st].values()] : [];
  if (stTickets.length === 0) { stRow.bp_tickets = null; stRow.bp_curve = []; return; }
  const threshold = stRow.exp_sec > 0 ? stRow.exp_sec / 60 : 15;
  const stCurve = buildIntervalCurve(stTickets);
  const bpRow = stCurve.find((r, i) => i >= 5 && r.occ >= 3 && r.ful > threshold);
  stRow.bp_tickets = bpRow ? bpRow.conc : null;
  stRow.bp_curve = stCurve;
});

// ---- stationDetails: per station, per day+hour ----
const stationDetails = {};
foodTickets.forEach(t => {
  const st = t['Station'];
  const day = DAYS[t._fired.getDay()];
  const hr = t._fired.getHours();
  const hrKey = `${hr}-${hr+1}`;
  if (!stationDetails[st]) stationDetails[st] = {};
  if (!stationDetails[st][day]) stationDetails[st][day] = {};
  if (!stationDetails[st][day][hrKey]) stationDetails[st][day][hrKey] = { count: 0, totalSec: 0 };
  stationDetails[st][day][hrKey].count++;
  stationDetails[st][day][hrKey].totalSec += t._fulSec;
});
// Convert to dashboard format: { stName: { byDayHour, hourly, breakingHours } }
const stationDetailsOut = {};
Object.keys(stationDetails).forEach(st => {
  const byDayHour = {};
  const hourlyAgg = {};
  const allRows = [];
  Object.keys(stationDetails[st]).forEach(day => {
    byDayHour[day] = {};
    Object.keys(stationDetails[st][day]).forEach(hr => {
      const d = stationDetails[st][day][hr];
      const avg_sec = +(d.totalSec / d.count).toFixed(1);
      byDayHour[day][hr] = { count: d.count, avg_sec, exp_sec: derivedStationTargets[st] || 0 };
      allRows.push({ day, hr, count: d.count, avg_sec, exp_sec: derivedStationTargets[st] || 0 });
      if (!hourlyAgg[hr]) hourlyAgg[hr] = { tw: 0, tc: 0 };
      hourlyAgg[hr].tw += d.totalSec;
      hourlyAgg[hr].tc += d.count;
    });
  });
  const hourly = {};
  Object.keys(hourlyAgg).forEach(hr => {
    const d = hourlyAgg[hr];
    hourly[hr] = { avg_sec: +(d.tw / d.tc).toFixed(1), exp_sec: derivedStationTargets[st] || 0 };
  });
  const breakingHours = allRows.filter(r => r.avg_sec > 900 && r.count > 0).slice(0, 20);
  stationDetailsOut[st] = { byDayHour, hourly, breakingHours };
});

// ---- Item → station from Toast prep map (item-station-map.json); targets fixed in map ----
function stripName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function lookupItemAssignment(menuItem) {
  let info = ITEM_ASSIGNMENTS[menuItem];
  if (!info) {
    const want = stripName(menuItem);
    const hit = Object.keys(ITEM_ASSIGNMENTS).find(k => stripName(k) === want);
    if (hit) info = ITEM_ASSIGNMENTS[hit];
  }
  return info || null;
}
function resolveAssignedStation(menuItem) {
  const info = lookupItemAssignment(menuItem);
  if (!info || !Array.isArray(info.stations)) return null;
  const ranked = info.stations.filter(st => st && isFood(st) && !/no\s*print/i.test(st));
  const cookFirst = ranked.find(st => !/expo|pass/i.test(st));
  return cookFirst || ranked[0] || null;
}
function resolveKitchenStation(assignedName) {
  if (!assignedName) return null;
  const keys = Object.keys(stationDetailsOut);
  const want = stripName(assignedName);
  for (const k of keys) {
    if (stripName(k) === want) return k;
  }
  let best = null;
  let bestLen = 0;
  for (const k of keys) {
    const kn = stripName(k);
    if ((kn.includes(want) || want.includes(kn)) && Math.min(kn.length, want.length) > bestLen) {
      best = k;
      bestLen = Math.min(kn.length, want.length);
    }
  }
  return best;
}


// ---- Beverage filter for station items ----
const BEVERAGE_KEYWORDS = [
  // Waters & soft drinks
  'evian', 'pellegrino', 'perrier', 'water', 'coke', 'coca', 'diet',
  'sprite', 'soda', 'juice', 'lemonade', 'iced tea', 'ginger ale',
  'still', 'sparkling', // bottled water labels without "water" in the name
  // Beer
  'beer', 'kronenbourg', 'heineken', 'stella', 'bud', 'corona', 'draft',
  // Wine & champagne
  'wine', 'champagne', 'prosecco', 'sancerre', 'pinot', 'chardonnay',
  'bordeaux', 'burgundy', 'rosé', 'rose', 'chard', 'chablis', 'viognier',
  'malbec', 'cabernet', 'merlot', 'syrah', 'shiraz', 'riesling', 'sauvignon',
  'mathiasson', 'vista',
  // Spirits & cocktails
  'vodka', 'gin', 'rum', 'tequila', 'whiskey', 'whisky', 'bourbon', 'scotch',
  'mezcal', 'espadin', 'conejos', 'blanco', 'reposado', 'anejo',
  'tito', 'belvedere', 'hendricks', 'hendrick', 'johnnie', 'johnie', 'walker',
  'balvenie', 'macallan', 'glenlivet', 'glenfiddich', 'jameson',
  'beluga', 'grey goose', 'ketel', 'absolut', 'tanqueray', 'bombay',
  'bacardi', 'patron', 'don julio', 'casamigos', 'centinela',
  'martini', 'negroni', 'cocktail', 'spritz', 'aperol', 'campari',
  'margarita', 'mimosa', 'bloody mary',
  'cognac', 'armagnac', 'calvados', 'brandy', 'port', 'sherry', 'vermouth',
  // Coffee & tea
  'espresso', 'coffee', 'latte', 'cappuccino', 'tea', 'barista', 'americano',
  // Wine list prefixes used at these venues
  'gl ', 'benoit', 'chauveau', 'et fill',
  // Modifier/combo items that aren't real dishes
  'all in savory', 'all in dessert', 'all in ',
];
function isBeverageItem(name) {
  const n = (name || '').toLowerCase();
  return BEVERAGE_KEYWORDS.some(kw => n.includes(kw));
}
/** Venue-specific menu noise — MILA MB-* market/banquet lines are out of BOH scope */
function isExcludedMenuItem(name) {
  if (!name) return true;
  if (isBeverageItem(name)) return true;
  if (venueArg === 'mila' && /^MB[\s_-]/i.test(String(name).trim())) return true;
  return false;
}

// ---- Item fulfillment report (Toast custom report — item-level avg time) ----
const itemFulPath = path.join(DATA_DIR, `item-fulfillment-${venueArg}.json`);
let itemFulfillmentItems = [];
if (fs.existsSync(itemFulPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(itemFulPath, 'utf8'));
    itemFulfillmentItems = raw.items || [];
  } catch (e) { console.warn('Could not load item-fulfillment:', e.message); }
}
const fulAvgByItem = {};
const fulCountByItem = {};
itemFulfillmentItems.forEach(it => {
  if (!it.menuItem || isExcludedMenuItem(it.menuItem)) return;
  if (it.avgSeconds != null && Number(it.avgSeconds) > 0) {
    fulAvgByItem[it.menuItem] = +adjustFulSec(Number(it.avgSeconds)).toFixed(1);
  }
  if (it.count > 0) fulCountByItem[it.menuItem] = it.count;
});

// ---- stationItemsArr: sold qty by prep-mapped station ----
const stationItemsMap = {};
const qtyByItem = {};
itemDetails.forEach(item => {
  if (!item.menuItem || isExcludedMenuItem(item.menuItem)) return;
  qtyByItem[item.menuItem] = (qtyByItem[item.menuItem] || 0) + (item.qty || 1);
  const station = resolveKitchenStation(resolveAssignedStation(item.menuItem));
  if (!station) return;
  if (!stationItemsMap[station]) stationItemsMap[station] = {};
  if (!stationItemsMap[station][item.menuItem]) {
    stationItemsMap[station][item.menuItem] = { qty: 0, avgFulSec: fulAvgByItem[item.menuItem] ?? null };
  }
  stationItemsMap[station][item.menuItem].qty += (item.qty || 1);
});

const stationItemsArr = {};
Object.keys(stationItemsMap).forEach(station => {
  stationItemsArr[station] = Object.entries(stationItemsMap[station])
    .map(([menuItem, d]) => ({
      menuItem,
      qty: d.qty,
      avgFulSec: d.avgFulSec,
      targetSec: (lookupItemAssignment(menuItem)?.targetSec > 0) ? lookupItemAssignment(menuItem).targetSec : null,
    }))
    .sort((a, b) => b.qty - a.qty);
});

// ---- assignmentData: full prep map × live fulfillment (item targets from map, not station average) ----
const assignmentRows = new Map();
Object.entries(ITEM_ASSIGNMENTS).forEach(([menuItem, info]) => {
  if (isExcludedMenuItem(menuItem)) return;
  const stations = (info.stations || []).filter(st => st && isFood(st) && !/no\s*print/i.test(st));
  if (!stations.length) return;
  const station = resolveKitchenStation(resolveAssignedStation(menuItem));
  if (!station) return;
  assignmentRows.set(menuItem, {
    menuItem,
    station,
    stations,
    targetSec: info.targetSec > 0 ? info.targetSec : null,
    avgFulSec: fulAvgByItem[menuItem] ?? null,
    count: fulCountByItem[menuItem] || qtyByItem[menuItem] || 0,
  });
});

const assignmentData = [...assignmentRows.values()]
  .sort((a, b) => (a.station || '').localeCompare(b.station || '') || a.menuItem.localeCompare(b.menuItem));

console.log(`Assignment data for ${venueArg}: ${assignmentData.length} prep-mapped items across ${new Set(assignmentData.map(i => i.station)).size} stations (${assignmentData.filter(i => i.targetSec > 0).length} with target)`);

// ---- menuItems: overall item volume + avg fulfillment ----
const menuItemsMap = {};
itemDetails.forEach(item => {
  if (!item.menuItem || isExcludedMenuItem(item.menuItem)) return;
  if (!menuItemsMap[item.menuItem]) menuItemsMap[item.menuItem] = { qty: 0 };
  menuItemsMap[item.menuItem].qty += (item.qty || 1);
});

const summary = Object.entries(menuItemsMap)
  .map(([menuItem, d]) => {
    const info = lookupItemAssignment(menuItem);
    return {
      menuItem,
      qty: d.qty,
      avgFulSec: fulAvgByItem[menuItem] ?? null,
      targetSec: info && info.targetSec > 0 ? info.targetSec : null,
      station: resolveKitchenStation(resolveAssignedStation(menuItem)) || null,
    };
  })
  .sort((a, b) => b.qty - a.qty);

Object.entries(fulAvgByItem).forEach(([menuItem, avgFulSec]) => {
  if (menuItemsMap[menuItem]) return;
  const info = lookupItemAssignment(menuItem);
  summary.push({
    menuItem,
    qty: 0,
    avgFulSec,
    targetSec: info && info.targetSec > 0 ? info.targetSec : null,
    station: resolveKitchenStation(resolveAssignedStation(menuItem)) || null,
  });
});

// ---- guestsSeated: OpenTable party-size totals (privacy-safe aggregates) ----
const guestsSeatedByDay = {};
let guestsSeatedTotal = 0;
parsedCovers.forEach(c => {
  if (!c.seated || isNaN(c.seated.getTime())) return;
  const day = DAYS[c.seated.getDay()];
  const size = Number(c.size) || 0;
  guestsSeatedByDay[day] = (guestsSeatedByDay[day] || 0) + size;
  guestsSeatedTotal += size;
});
const guestsSeated = {
  total: guestsSeatedTotal,
  byDay: guestsSeatedByDay,
  coverCount: parsedCovers.length,
};

// ---- stationDayVolume: ticket fires + item qty + weighted ful by station/day ----
const stationDayVolume = {};
Object.keys(stationDetailsOut).forEach(st => {
  stationDayVolume[st] = {};
  const byDayHour = stationDetailsOut[st].byDayHour || {};
  Object.keys(byDayHour).forEach(day => {
    let ticketCount = 0;
    let fulSecSum = 0;
    Object.values(byDayHour[day] || {}).forEach(cell => {
      ticketCount += cell.count || 0;
      fulSecSum += (cell.avg_sec || 0) * (cell.count || 0);
    });
    stationDayVolume[st][day] = {
      ticketCount,
      itemQty: 0,
      avgFulSec: ticketCount > 0 ? +(fulSecSum / ticketCount).toFixed(1) : null,
    };
  });
});

// Roll food item qty onto station+day using Toast prep-station map only.
let qtyAssigned = 0;
let qtySkipped = 0;
itemDetails.forEach(item => {
  if (!item.menuItem || isExcludedMenuItem(item.menuItem)) return;
  const fired = parseDate(item.sentDate);
  if (!fired) return;
  const day = DAYS[fired.getDay()];
  const qty = item.qty || 1;

  const station = resolveKitchenStation(resolveAssignedStation(item.menuItem));
  if (!station || !isFood(station) || /no\s*print/i.test(station)) {
    qtySkipped += qty;
    return;
  }
  if (!stationDayVolume[station]) stationDayVolume[station] = {};
  if (!stationDayVolume[station][day]) {
    stationDayVolume[station][day] = { ticketCount: 0, itemQty: 0, avgFulSec: null };
  }
  stationDayVolume[station][day].itemQty += qty;
  qtyAssigned += qty;
});
console.log(`Item qty→station: prep-mapped=${qtyAssigned}, unmapped/skipped=${qtySkipped}`);

// ---- stationHourItems: full sold listing by station / day / hour (menu item qty) ----
const stationHourItems = {};
itemDetails.forEach(item => {
  if (!item.menuItem || isExcludedMenuItem(item.menuItem)) return;
  const fired = parseDate(item.sentDate);
  if (!fired) return;
  const station = resolveKitchenStation(resolveAssignedStation(item.menuItem));
  if (!station || !isFood(station) || /no\s*print/i.test(station)) return;
  const day = DAYS[fired.getDay()];
  const hr = fired.getHours();
  const hrKey = `${hr}-${hr + 1}`;
  const qty = item.qty || 1;
  const info = lookupItemAssignment(item.menuItem);
  const hasTarget = !!(info && info.targetSec > 0);
  if (!stationHourItems[station]) stationHourItems[station] = {};
  if (!stationHourItems[station][day]) stationHourItems[station][day] = {};
  if (!stationHourItems[station][day][hrKey]) stationHourItems[station][day][hrKey] = [];
  const hh = fired.getHours();
  const mm = String(fired.getMinutes()).padStart(2, '0');
  const ap = hh >= 12 ? 'p' : 'a';
  let h12 = hh % 12; if (h12 === 0) h12 = 12;
  stationHourItems[station][day][hrKey].push({
    n: item.menuItem,
    q: qty,
    t: `${DAYS[fired.getDay()].slice(0, 3)} ${h12}:${mm}${ap}`,
    tgt: hasTarget ? 1 : 0,
    table: item.table || '',
  });
  if (stationDetailsOut[station] && stationDetailsOut[station].byDayHour) {
    if (!stationDetailsOut[station].byDayHour[day]) stationDetailsOut[station].byDayHour[day] = {};
    const cell = stationDetailsOut[station].byDayHour[day][hrKey] || { count: 0, avg_sec: 0, exp_sec: derivedStationTargets[station] || 0 };
    cell.itemQty = (cell.itemQty || 0) + qty;
    stationDetailsOut[station].byDayHour[day][hrKey] = cell;
  }
});
Object.values(stationHourItems).forEach(days => {
  Object.values(days).forEach(hours => {
    Object.keys(hours).forEach(hk => {
      hours[hk].sort((a, b) => String(a.t).localeCompare(String(b.t)));
    });
  });
});

// ---- Output ----
const output = {
  stations,
  summary,
  hmFul,
  hmGuests: hmGuestsFlat,
  guestsSeated,
  hourProfile,
  curve,
  curveByDay,
  tbk,
  breakingPoint,
  breakingPointGuests,
  serviceBreakTimeline,
  stationItemsArr,
  stationDetails: stationDetailsOut,
  stationHourItems,
  stationDayVolume,
  assignmentData,
  ticketSummary: {
    rawKitchenRows: tickets.length,
    nonFoodExcluded: skippedNonFood,
    openOrUnclosed: skippedOpen,
    over90MinExcluded: skippedLong,
    foodStationTicketRows: foodTickets.length,
    orderCount: orderTickets.length,
    uniqueTickets: orderTickets.length,
    stationFireCount: stations.reduce((s, st) => s + (st.count || 0), 0),
    itemDetailSkuCount: summary.length,
    itemQtyTotal: Math.round(summary.reduce((s, r) => s + (r.qty || 0), 0)),
    fulfillmentAdjustSec: FULFILLMENT_ADJUST_SEC,
  },
};

// Preserve previously joined staffing aggregates if present (rebuilt by weekly-staffing)
function mergePreserveStaffing(outObj, existingPath) {
  if (!fs.existsSync(existingPath)) return outObj;
  try {
    const prev = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
    if (prev && prev.staffing && !outObj.staffing) outObj.staffing = prev.staffing;
  } catch (_) { /* ignore */ }
  return outObj;
}

const outPath = path.join(__dirname, `${venueArg}-data.json`);
fs.writeFileSync(outPath, JSON.stringify(mergePreserveStaffing(output, outPath)), 'utf8');
console.log(`Written to ${outPath}`);
if (weekArg) {
  const weekOutPath = path.join(__dirname, `${venueArg}-data-${weekArg}.json`);
  fs.writeFileSync(weekOutPath, JSON.stringify(mergePreserveStaffing({ ...output }, weekOutPath)), 'utf8');
  console.log(`Written to ${weekOutPath}`);
}
console.log('Stations:', stations.map(s => `${s.station}(${s.count})`).join(', '));
