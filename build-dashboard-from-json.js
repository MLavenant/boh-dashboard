/**
 * build-dashboard-from-json.js
 * Reads data/rolling.json and produces claudie-dashboard-data.json
 * for use by rebuild-dashboard.js (replaces the Excel-based build-dashboard-data.js)
 *
 * Run: node C:\Cursor\toast-mcp-server\build-dashboard-from-json.js
 */

import fs from "fs";
import path from "path";

const ROLLING_FILE      = "C:\\Cursor\\toast-mcp-server\\data\\rolling.json";
const OUTPUT_FILE       = "C:\\Cursor\\toast-mcp-server\\claudie-dashboard-data.json";
const TARGET_VENUE      = "claudie";
const TARGET_MINS       = 15;
const TARGET_SECS       = TARGET_MINS * 60;
const DAY_LABELS        = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EXCLUDE_STATIONS  = new Set(["No Print", "No Print ", "No Print  "]);

// ── Helpers ────────────────────────────────────────────────────────────────

function parseFulfillmentStr(ft) {
  if (!ft || typeof ft !== "string") return null;
  const m = ft.match(/(\d+)\s*minute[^0-9]*(\d+)\s*second/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  const m2 = ft.match(/(\d+)\s*minute/);
  if (m2) return parseInt(m2[1]) * 60;
  const s = ft.match(/(\d+)\s*second/);
  if (s) return parseInt(s[1]);
  return null;
}

function cleanStation(s) {
  return (s || "").replace(/\s+$/, "");
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ── Load rolling.json ──────────────────────────────────────────────────────

const rolling = JSON.parse(fs.readFileSync(ROLLING_FILE, "utf8"));
const weeks = rolling.weeks || [];

if (!weeks.length) {
  console.error("No weeks in rolling.json");
  process.exit(1);
}

// Current week = index 0, prior weeks = rest
const currentWeek = weeks[0];
const priorWeeks  = weeks.slice(1);

console.log(`Current week: ${currentWeek.weekLabel} (${currentWeek.startDate} → ${currentWeek.endDate})`);
console.log(`Prior weeks:  ${priorWeeks.map(w => w.weekLabel).join(", ") || "(none)"}`);

// ── Extract Claudie tickets ────────────────────────────────────────────────

function extractTickets(weekEntry) {
  const v = weekEntry.venues?.[TARGET_VENUE];
  if (!v || !v.tickets || !v.tickets.length) return [];
  return v.tickets
    .map(t => {
      const station = cleanStation(t["Station"] || t.station || "");
      const fulfillStr = t["Fulfillment Time"] || t["FulfillmentTime"] || t.fulfillmentTime || t.fulfillSecs;
      let fulfillSecs;
      if (typeof fulfillStr === "number") {
        fulfillSecs = fulfillStr;
      } else {
        fulfillSecs = parseFulfillmentStr(String(fulfillStr || ""));
      }
      const firedStr    = t["Fired Date"]     || t.firedDate     || null;
      const fulfilledStr = t["Fulfilled Date"] || t.fulfilledDate || null;
      const checkNum    = t["ID"]            || t.id      || t["Check #"] || null;
      return {
        station,
        fulfillSecs,
        firedDate:    firedStr    ? new Date(firedStr)    : null,
        fulfilledDate: fulfilledStr ? new Date(fulfilledStr) : null,
        checkNum: String(checkNum || ""),
      };
    })
    .filter(t => t.fulfillSecs > 0 && t.station && !EXCLUDE_STATIONS.has(t.station));
}

const tickets1 = extractTickets(currentWeek);

// Combine current + prior tickets for 3-week pressure curve
const ticketsAll = [
  ...tickets1,
  ...priorWeeks.flatMap(w => extractTickets(w)),
];

console.log(`Claudie tickets: ${tickets1.length} (current), ${ticketsAll.length} (all weeks)`);

// ── KPIs ──────────────────────────────────────────────────────────────────

const uniqueChecks  = new Set(tickets1.map(t => t.checkNum));
const validFills    = tickets1.map(t => t.fulfillSecs).filter(Boolean);
const avgFulfill    = validFills.length ? avg(validFills) : 0;

// Problem hours: hours where avg fulfillment > target
const hourFills = {};
tickets1.forEach(t => {
  if (!t.firedDate) return;
  const h = t.firedDate.getHours();
  if (!hourFills[h]) hourFills[h] = [];
  hourFills[h].push(t.fulfillSecs);
});
const problemHours = Object.values(hourFills).filter(arr => avg(arr) > TARGET_SECS).length;
const stationSet   = new Set(tickets1.map(t => t.station));

// ── Pressure Curve (sweep-line O(n log n)) ────────────────────────────────

function computePressureCurve(tickets) {
  const valid = tickets.filter(t => t.firedDate && t.fulfilledDate && t.fulfillSecs > 0);
  if (!valid.length) return { loadLevels: [], avgByLoad: [], countByLoad: [] };

  const events = [];
  valid.forEach((t, i) => {
    events.push({ time: t.firedDate.getTime(),       type:  1, idx: i });
    events.push({ time: t.fulfilledDate.getTime() + 1, type: -1, idx: i });
  });
  events.sort((a, b) => a.time - b.time || a.type - b.type);

  const firedTimes = valid
    .map((t, i) => ({ time: t.firedDate.getTime(), secs: t.fulfillSecs, idx: i }))
    .sort((a, b) => a.time - b.time);

  let concurrent = 0;
  let evtIdx = 0;
  const groups = {};

  for (const ft of firedTimes) {
    while (evtIdx < events.length && events[evtIdx].time <= ft.time) {
      concurrent += events[evtIdx].type;
      evtIdx++;
    }
    const c = Math.max(1, concurrent);
    if (!groups[c]) groups[c] = [];
    groups[c].push(ft.secs);
  }

  const maxLoad    = Math.min(Math.max(...Object.keys(groups).map(Number), 1), 30);
  const loadLevels = Array.from({ length: maxLoad }, (_, i) => i + 1);
  const avgByLoad  = loadLevels.map(l => {
    const arr = groups[l] || [];
    return arr.length ? Math.round(avg(arr) / 60 * 10) / 10 : null;
  });
  const countByLoad = loadLevels.map(l => (groups[l] || []).length);
  return { loadLevels, avgByLoad, countByLoad };
}

const pressure1 = computePressureCurve(tickets1);
const pressureAll = computePressureCurve(ticketsAll);

// ── Fulfillment Heatmap ───────────────────────────────────────────────────

const heatmapRaw = {};
tickets1.forEach(t => {
  if (!t.firedDate) return;
  const day  = t.firedDate.getDay();
  const hour = t.firedDate.getHours();
  const key  = `${day}-${hour}`;
  if (!heatmapRaw[key]) heatmapRaw[key] = [];
  heatmapRaw[key].push(t.fulfillSecs);
});

const daysPresent  = [...new Set(tickets1.filter(t => t.firedDate).map(t => t.firedDate.getDay()))].sort();
const hoursPresent = [...new Set(tickets1.filter(t => t.firedDate).map(t => t.firedDate.getHours()))].sort((a, b) => a - b);

const heatmapData = daysPresent.map(day => ({
  day:   DAY_LABELS[day],
  hours: hoursPresent.map(hour => {
    const arr = heatmapRaw[`${day}-${hour}`] || [];
    return { hour, avg: arr.length ? Math.round(avg(arr) / 60 * 10) / 10 : null, count: arr.length };
  }),
}));

// ── Station Stats ─────────────────────────────────────────────────────────

const stationData = {};
tickets1.forEach(t => {
  const st = t.station;
  if (!stationData[st]) stationData[st] = { times: [], hours: {} };
  stationData[st].times.push(t.fulfillSecs);
  if (t.firedDate) {
    const h = t.firedDate.getHours();
    if (!stationData[st].hours[h]) stationData[st].hours[h] = [];
    stationData[st].hours[h].push(t.fulfillSecs);
  }
});

const stations = Object.entries(stationData)
  .map(([name, d]) => {
    const a = avg(d.times);
    const hourly = hoursPresent.map(h => ({
      hour: h,
      avg:   d.hours[h]?.length ? Math.round(avg(d.hours[h]) / 60 * 10) / 10 : null,
      count: d.hours[h]?.length || 0,
    }));
    return { name, tickets: d.times.length, avgSecs: Math.round(a), avgMins: Math.round(a / 60 * 10) / 10, targetMins: null, hourly };
  })
  .filter(s => s.tickets >= 5)
  .sort((a, b) => b.avgMins - a.avgMins);

// ── Breaking point ────────────────────────────────────────────────────────

let breakingPoint = null;
for (let i = 1; i < pressure1.loadLevels.length - 1; i++) {
  if (pressure1.avgByLoad[i] > TARGET_MINS && pressure1.avgByLoad[i + 1] > TARGET_MINS) {
    breakingPoint = pressure1.loadLevels[i];
    break;
  }
}

const peakConcurrent = pressure1.countByLoad.length
  ? Math.max(...pressure1.countByLoad.map((c, i) => c > 0 ? pressure1.loadLevels[i] : 0))
  : 0;

// ── OT Covers Heatmap ─────────────────────────────────────────────────────

function buildCoversHeatmap(weekEntries) {
  // Collect all claudie covers across the provided weeks
  const allCovers = weekEntries.flatMap(w => w.venues?.[TARGET_VENUE]?.covers || []);
  if (!allCovers.length) return { days: [], hours: [], grid: {}, gbk: [], bp_g: null };

  // For each 15-min slot, count concurrent guests (partySize-weighted)
  // Build slot map: "day-hour-quarter" → [partySizes at that time]
  const slotParties = {};

  allCovers.forEach(c => {
    if (!c.seatedTime) return;
    const seated   = new Date(c.seatedTime);
    const finished = c.finishedTime ? new Date(c.finishedTime) : new Date(seated.getTime() + 90 * 60000);
    const partySize = c.partySize || 1;

    // Walk in 15-min steps
    let cur = new Date(seated);
    cur.setSeconds(0, 0);
    const mins = cur.getMinutes();
    cur.setMinutes(mins - (mins % 15)); // round down to quarter hour

    while (cur < finished) {
      const day  = cur.getDay();
      const hour = cur.getHours();
      const key  = `${day}-${hour}`;
      if (!slotParties[key]) slotParties[key] = [];
      slotParties[key].push(partySize);
      cur = new Date(cur.getTime() + 15 * 60000);
    }
  });

  const covDays  = [...new Set(Object.keys(slotParties).map(k => parseInt(k.split("-")[0])))].sort();
  const covHours = [...new Set(Object.keys(slotParties).map(k => parseInt(k.split("-")[1])))].sort((a, b) => a - b);

  // Average concurrent guests per day-hour slot
  const grid = {};
  covDays.forEach(day => {
    const dayLabel = DAY_LABELS[day];
    grid[dayLabel] = {};
    covHours.forEach(hour => {
      const arr = slotParties[`${day}-${hour}`] || [];
      if (arr.length) grid[dayLabel][`${hour}-${hour + 1}`] = Math.round(avg(arr) * 10) / 10;
    });
  });

  const days  = covDays.map(d => DAY_LABELS[d]);
  const hours = covHours.map(h => `${h}-${h + 1}`);

  // Breaking-point analysis: does avg fulfillment spike when covers exceed threshold?
  // Compare avg covers per night vs avg fulfillment — bucket by concurrent guests
  // (simplified: use cover count buckets of 10)
  const gbk = [];
  const guestBuckets = {};
  allCovers.forEach(c => {
    if (!c.seatedTime || !c.partySize) return;
    const seated = new Date(c.seatedTime);
    const hour   = seated.getHours();
    const bucket = Math.floor(c.partySize / 2) * 2; // bucket by party size
    const label  = `${bucket}–${bucket + 1}`;
    if (!guestBuckets[label]) guestBuckets[label] = 0;
    guestBuckets[label]++;
  });
  Object.entries(guestBuckets).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).forEach(([bucket, count]) => {
    gbk.push({ bucket, count });
  });

  return { days, hours, grid, gbk, bp_g: null };
}

const coversData = buildCoversHeatmap(weeks);

// ── Meta ──────────────────────────────────────────────────────────────────

const allFiredDates = tickets1.filter(t => t.firedDate).map(t => t.firedDate);
let weekRange = currentWeek.startDate + " – " + currentWeek.endDate;
if (allFiredDates.length) {
  const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  weekRange = fmt(new Date(Math.min(...allFiredDates))) + " – " + fmt(new Date(Math.max(...allFiredDates)));
}

// ── Output ────────────────────────────────────────────────────────────────

const output = {
  meta: {
    location:  "Claudie",
    weekRange,
    weekLabel: currentWeek.weekLabel,
    refreshed: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    generatedAt: new Date().toISOString(),
  },
  kpis: {
    totalTickets:   uniqueChecks.size,
    avgFulfillMins: Math.round(avgFulfill / 60 * 10) / 10,
    problemHours,
    peakConcurrent,
    stationCount:   stationSet.size,
    targetMins:     TARGET_MINS,
  },
  pressureCurve: {
    lastWeek:    pressure1,
    prior3Weeks: pressureAll,
    targetMins:  TARGET_MINS,
  },
  breakingPoint,
  heatmap:  heatmapData,
  hours:    hoursPresent,
  stations,
  menuItems: [],   // not available from JSON — placeholder for rebuild-dashboard.js compatibility
  summary: (currentWeek.venues?.[TARGET_VENUE]?.itemFulfillment || [])
    .map(r => ({ item: r.menuItem, count: r.count, avg_sec: r.avgSeconds })),
  covers:   coversData,
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
console.log("=== DASHBOARD DATA (from JSON) ===");
console.log("Location:       ", output.meta.location);
console.log("Week:           ", output.meta.weekRange);
console.log("Total tickets:  ", output.kpis.totalTickets);
console.log("Avg fulfillment:", output.kpis.avgFulfillMins, "min");
console.log("Problem hours:  ", output.kpis.problemHours);
console.log("Peak concurrent:", output.kpis.peakConcurrent);
console.log("Stations:       ", output.kpis.stationCount);
console.log("Breaking point: ", output.breakingPoint);
console.log("Covers days:    ", coversData.days.join(", ") || "(none)");
console.log(`Written to ${OUTPUT_FILE}`);
