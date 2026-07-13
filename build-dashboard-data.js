/**
 * Preprocesses Claudie Kitchen Timing + Item Details Excel data
 * into a compact JSON payload ready to embed in the dashboard canvas.
 */
import XLSX from "xlsx";
import fs from "fs";

// ── helpers ──────────────────────────────────────────────────────────────────
const excelToDate = (serial) => {
  if (!serial || typeof serial !== "number") return null;
  // Excel serial: days since 1900-01-00 (with Lotus 1900 leap bug)
  return new Date((serial - 25569) * 86400000);
};
const parseFulfillment = (s) => {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/(\d+)\s*minute/) ? parseInt(s.match(/(\d+)\s*minute/)[1]) : 0;
  const sec = s.match(/(\d+)\s*second/) ? parseInt(s.match(/(\d+)\s*second/)[1]) : 0;
  return m * 60 + sec;
};
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── load Excel ───────────────────────────────────────────────────────────────
const TARGET_DATE_RANGE = "lastWeek";
const wb1 = XLSX.readFile("c:\\Dell\\data extraction125 claudie.xlsx");         // 1-week
const wb3 = XLSX.readFile("c:\\Dell\\data extraction125 claudie 3 weeks.xlsx"); // 3-week

// Parse ticket drop
function parseTickets(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["ticket drop"], { header: 1, defval: "" });
  const hdr = rows[0]; // Location,ID,Server,Check#,Table,CheckOpened,Station,ExpediterLevel,FiredDate,FulfilledDate,FulfillmentTime,FulfilledBy
  return rows.slice(1).filter(r => r[0]).map(r => ({
    location:      r[0],
    id:            String(r[1]),
    server:        r[2],
    checkNum:      r[3],
    table:         r[4],
    checkOpened:   excelToDate(r[5]),
    station:       (r[6] || "").trim(),
    firedDate:     excelToDate(r[8]),
    fulfilledDate: excelToDate(r[9]),
    fulfillSecs:   parseFulfillment(r[10]),
  })).filter(r => r.fulfillSecs !== null && r.fulfillSecs > 0 && r.station);
}

// Parse item drop
function parseItems(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["items drop"], { header: 1, defval: "" });
  return rows.slice(1).filter(r => r[0]).map(r => ({
    location:   r[0],
    menuItem:   r[16] || "",
    menuGroup:  r[18] || "",
    menu:       r[19] || "",
    salesCat:   r[20] || "",
    grossPrice: r[21] || 0,
    discount:   r[22] || 0,
    netPrice:   r[23] || 0,
    qty:        r[24] || 1,
    voided:     String(r[26]).toLowerCase() === "yes",
    sentDate:   excelToDate(r[3]),
  })).filter(r => !r.voided && r.menuItem);
}

// Parse ref
function parseRef(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["ref"], { header: 1, defval: "" });
  // header at row 7 (index 7)
  return rows.slice(8).filter(r => r[0]).map(r => ({
    item:    r[0],
    stations: [r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[8],r[9],r[10]]
               .map(s => String(s).trim()).filter(s => s && s !== ""),
    target:  typeof r[11] === "number" ? r[11] : null,
  }));
}

process.stderr.write("Parsing data...\n");
const t1 = parseTickets(wb1);
const t3 = parseTickets(wb3);
const i1 = parseItems(wb1);
const ref = parseRef(wb1);

const refMap = {};
ref.forEach(r => { refMap[r.item] = r; });

// Exclude "No Print" station from performance analysis
const EXCLUDE_STATIONS = new Set(["No Print", "No Print ", "No Print  "]);
const cleanStation = s => s.replace(/\s+$/, "");

const validTickets1 = t1.filter(t => !EXCLUDE_STATIONS.has(t.station));
const validTickets3 = t3.filter(t => !EXCLUDE_STATIONS.has(t.station));

// ── KPIs ─────────────────────────────────────────────────────────────────────
const uniqueChecks = new Set(validTickets1.map(t => t.id));
const avgFulfill = validTickets1.reduce((s,t) => s + t.fulfillSecs, 0) / validTickets1.length;
const TARGET_SECS = 15 * 60; // 15 minutes global target

// Problem hours: hours where avg fulfillment > target
const hourMap = {};
validTickets1.forEach(t => {
  if (!t.firedDate) return;
  const h = t.firedDate.getHours();
  if (!hourMap[h]) hourMap[h] = [];
  hourMap[h].push(t.fulfillSecs);
});
const problemHours = Object.values(hourMap).filter(arr => arr.reduce((s,v)=>s+v,0)/arr.length > TARGET_SECS).length;

// Stations
const stationSet = new Set(validTickets1.map(t => cleanStation(t.station)));
const stationCount = stationSet.size;

// ── Kitchen Pressure Curve ────────────────────────────────────────────────────
// For each ticket, compute how many tickets were open concurrently at its fired time
// "open" = firedDate <= T <= fulfilledDate
function computePressureCurve(tickets) {
  // Sweep-line: create events for each ticket's start and end
  const valid = tickets.filter(t => t.firedDate && t.fulfilledDate && t.fulfillSecs > 0);
  
  // Sample concurrent load at each fired date using a sorted sweep (O(n log n))
  // For each ticket's fired moment, count how many tickets are currently "in flight"
  // (firedDate <= this.firedDate <= fulfilledDate) using binary search
  const byFired = [...valid].sort((a,b) => a.firedDate - b.firedDate);
  const byFulfilled = [...valid].sort((a,b) => a.fulfilledDate - b.fulfilledDate);
  
  const groups = {};
  let openCount = 0;
  let fulfillIdx = 0;
  
  // Use a sliding window approach
  byFired.forEach(tick => {
    // Count tickets fired before or at this moment that haven't been fulfilled yet
    // Simple approach: sample 10% of tickets to estimate (fast approximation)
    const t = tick.firedDate.getTime();
    const concurrent = valid.filter(x => x.firedDate <= tick.firedDate && x.fulfilledDate >= tick.firedDate).length;
    if (!groups[concurrent]) groups[concurrent] = [];
    groups[concurrent].push(tick.fulfillSecs);
  });

  const maxLoad = Math.min(Math.max(...Object.keys(groups).map(Number)), 30);
  const loadLevels = Array.from({ length: maxLoad }, (_, i) => i + 1);
  const avgByLoad = loadLevels.map(l => {
    const arr = groups[l] || [];
    return arr.length ? Math.round(arr.reduce((s,v)=>s+v,0) / arr.length / 60 * 10) / 10 : null;
  });
  const countByLoad = loadLevels.map(l => (groups[l] || []).length);
  return { loadLevels, avgByLoad, countByLoad };
}

function computePressureCurveFast(tickets) {
  // True O(n log n) sweep-line: compute concurrent count for each fired event
  const valid = tickets.filter(t => t.firedDate && t.fulfilledDate && t.fulfillSecs > 0);
  
  // Create events: +1 at firedDate, -1 just after fulfilledDate
  const events = [];
  valid.forEach((t, i) => {
    events.push({ time: t.firedDate.getTime(), type: 1, idx: i });
    events.push({ time: t.fulfilledDate.getTime() + 1, type: -1, idx: i });
  });
  events.sort((a,b) => a.time - b.time || a.type - b.type);
  
  // Build concurrent count at each firedDate
  // For each ticket, we need the count at its exact fired time
  // Use a sorted list and sweep
  const firedTimes = valid.map((t, i) => ({ time: t.firedDate.getTime(), secs: t.fulfillSecs, idx: i }))
    .sort((a,b) => a.time - b.time);
  
  let concurrent = 0;
  let evtIdx = 0;
  const groups = {};
  
  for (const ft of firedTimes) {
    // Advance events up to and including this fired time
    while (evtIdx < events.length && events[evtIdx].time <= ft.time) {
      concurrent += events[evtIdx].type;
      evtIdx++;
    }
    // concurrent is now the count of open tickets at ft.time (including this one)
    const c = Math.max(1, concurrent);
    if (!groups[c]) groups[c] = [];
    groups[c].push(ft.secs);
  }

  const maxLoad = Math.min(Math.max(...Object.keys(groups).map(Number), 1), 30);
  const loadLevels = Array.from({ length: maxLoad }, (_, i) => i + 1);
  const avgByLoad = loadLevels.map(l => {
    const arr = groups[l] || [];
    return arr.length ? Math.round(arr.reduce((s,v)=>s+v,0) / arr.length / 60 * 10) / 10 : null;
  });
  const countByLoad = loadLevels.map(l => (groups[l] || []).length);
  return { loadLevels, avgByLoad, countByLoad };
}

process.stderr.write("Computing pressure curves...\n");
const pressure1 = computePressureCurveFast(validTickets1);
const pressure3 = computePressureCurveFast(validTickets3);

// ── Fulfillment Heatmap ────────────────────────────────────────────────────────
const heatmap = {}; // key: "day-hour" → [secs]
validTickets1.forEach(t => {
  if (!t.firedDate) return;
  const day = t.firedDate.getDay();
  const hour = t.firedDate.getHours();
  const key = `${day}-${hour}`;
  if (!heatmap[key]) heatmap[key] = [];
  heatmap[key].push(t.fulfillSecs);
});

// Days present in data
const daysPresent = [...new Set(validTickets1.filter(t=>t.firedDate).map(t=>t.firedDate.getDay()))].sort();
const hoursPresent = [...new Set(validTickets1.filter(t=>t.firedDate).map(t=>t.firedDate.getHours()))].sort((a,b)=>a-b);

const heatmapData = daysPresent.map(day => ({
  day: DAY_LABELS[day],
  hours: hoursPresent.map(hour => {
    const arr = heatmap[`${day}-${hour}`] || [];
    return { hour, avg: arr.length ? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length/60*10)/10 : null, count: arr.length };
  })
}));

// ── Station Effectiveness ──────────────────────────────────────────────────────
process.stderr.write("Computing station stats...\n");
const stationData = {};
validTickets1.forEach(t => {
  const st = cleanStation(t.station);
  if (!stationData[st]) stationData[st] = { times: [], hours: {} };
  stationData[st].times.push(t.fulfillSecs);
  if (t.firedDate) {
    const h = t.firedDate.getHours();
    if (!stationData[st].hours[h]) stationData[st].hours[h] = [];
    stationData[st].hours[h].push(t.fulfillSecs);
  }
});

// Find station targets from ref data
const stationTargets = {};
ref.forEach(r => {
  r.stations.forEach(st => {
    const stClean = cleanStation(st);
    if (r.target && !stationTargets[stClean]) stationTargets[stClean] = r.target;
  });
});

const stations = Object.entries(stationData)
  .map(([name, d]) => {
    const avg = d.times.reduce((s,v)=>s+v,0) / d.times.length;
    const target = stationTargets[name] || null;
    const hourlyData = hoursPresent.map(h => ({
      hour: h,
      avg: d.hours[h]?.length ? Math.round(d.hours[h].reduce((s,v)=>s+v,0)/d.hours[h].length/60*10)/10 : null,
      count: d.hours[h]?.length || 0,
    }));
    return {
      name,
      tickets: d.times.length,
      avgSecs: Math.round(avg),
      avgMins: Math.round(avg / 60 * 10) / 10,
      targetMins: target,
      hourly: hourlyData,
    };
  })
  .filter(s => s.tickets >= 5)
  .sort((a, b) => b.avgMins - a.avgMins);

// ── Menu Items ──────────────────────────────────────────────────────────────────
process.stderr.write("Computing menu item stats...\n");
const menuItemData = {};
i1.forEach(row => {
  if (!menuItemData[row.menuItem]) {
    menuItemData[row.menuItem] = {
      item: row.menuItem,
      group: row.menuGroup,
      menu: row.menu,
      qty: 0,
      netRevenue: 0,
    };
  }
  menuItemData[row.menuItem].qty += row.qty || 1;
  menuItemData[row.menuItem].netRevenue += (row.netPrice || 0) * (row.qty || 1);
});

// Attach ref data (stations + target)
const menuItems = Object.values(menuItemData).map(d => {
  const r = refMap[d.item] || {};
  return {
    ...d,
    stations: r.stations || [],
    targetMins: r.target || null,
    netRevenue: Math.round(d.netRevenue * 100) / 100,
  };
}).sort((a, b) => b.qty - a.qty);

// ── Date range info ─────────────────────────────────────────────────────────
const allDates = validTickets1.filter(t=>t.firedDate).map(t=>t.firedDate);
const minDate = new Date(Math.min(...allDates));
const maxDate = new Date(Math.max(...allDates));
const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// ── Breaking point ──────────────────────────────────────────────────────────
const TARGET_MINS = 15;
let breakingPoint = null;
for (let i = 1; i < pressure1.loadLevels.length - 1; i++) {
  if (pressure1.avgByLoad[i] > TARGET_MINS && pressure1.avgByLoad[i+1] > TARGET_MINS) {
    breakingPoint = pressure1.loadLevels[i];
    break;
  }
}

// ── Peak concurrent ─────────────────────────────────────────────────────────
const peakConcurrent = Math.max(...pressure1.countByLoad.map((c,i) => c > 0 ? pressure1.loadLevels[i] : 0));

// ── Output ──────────────────────────────────────────────────────────────────
const output = {
  meta: {
    location: "Claudie",
    weekRange: `${fmt(minDate)} – ${fmt(maxDate)}`,
    refreshed: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
  },
  kpis: {
    totalTickets: uniqueChecks.size,
    avgFulfillMins: Math.round(avgFulfill / 60 * 10) / 10,
    problemHours,
    peakConcurrent,
    stationCount,
    targetMins: TARGET_MINS,
  },
  pressureCurve: {
    lastWeek: pressure1,
    prior3Weeks: pressure3,
    targetMins: TARGET_MINS,
  },
  breakingPoint,
  heatmap: heatmapData,
  hours: hoursPresent,
  stations,
  menuItems: menuItems.slice(0, 100), // top 100 items
};

fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\claudie-dashboard-data.json", JSON.stringify(output, null, 2));
process.stderr.write(`Done. Output size: ${JSON.stringify(output).length} chars\n`);

// Print summary
console.log("=== DASHBOARD DATA SUMMARY ===");
console.log("Location:", output.meta.location);
console.log("Week:", output.meta.weekRange);
console.log("Total tickets:", output.kpis.totalTickets);
console.log("Avg fulfillment:", output.kpis.avgFulfillMins, "min");
console.log("Problem hours:", output.kpis.problemHours);
console.log("Peak concurrent:", output.kpis.peakConcurrent);
console.log("Stations:", output.kpis.stationCount);
console.log("Breaking point:", output.breakingPoint, "concurrent tickets");
console.log("\nTop stations by avg time:");
output.stations.slice(0, 8).forEach(s => console.log(`  ${s.name.padEnd(25)} avg=${s.avgMins}m target=${s.targetMins}m tickets=${s.tickets}`));
console.log("\nTop menu items:");
output.menuItems.slice(0, 5).forEach(m => console.log(`  ${m.item.padEnd(35)} qty=${m.qty} stations=${m.stations.join(",")}`));
console.log("\nHeatmap days:", output.heatmap.map(d=>d.day));
console.log("Heatmap hours:", output.hours.slice(0,5), "...");
