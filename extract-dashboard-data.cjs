const path = require('path');
const XLSX = require(path.join(__dirname, 'node_modules/xlsx'));

const EXCEL_PATH = 'C:\\Dell\\Week 20cl2.xlsx';
const wb = XLSX.readFile(EXCEL_PATH);

function sheetToJson(name) {
  if (!wb.SheetNames.includes(name)) return null;
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
}

const EXCLUDE_WORDS = ['bar','champagne','wine','btg','pos','barista'];
function isFood(name) {
  if (!name) return false;
  const low = name.toLowerCase();
  return !EXCLUDE_WORDS.some(w => low.includes(w));
}

// Fix encoding issues: xlsx sometimes reads accented chars incorrectly from CP1252
function fixEncoding(str) {
  if (typeof str !== 'string') return str;
  // Common CP1252 -> UTF8 mojibake fixes
  return str
    .replace(/\u00c3\u00a9/g, '\u00e9') // é
    .replace(/\u00c3\u00a8/g, '\u00e8') // è
    .replace(/\u00c3\u00aa/g, '\u00ea') // ê
    .replace(/\u00c3\u00a0/g, '\u00e0') // à
    .replace(/\u00c3\u00b4/g, '\u00f4') // ô
    .replace(/Saut\xe9/g, 'Sauté') // direct fix
    .replace(/Saut[^\w\s]/g, 'Sauté'); // fallback
}

// Normalize station name for display and matching
function normName(name) {
  if (!name) return name;
  // Try to restore "Sauté" from any mangled form
  if (/[Ss]aut./.test(name) && !name.includes('Sauté')) {
    return name.replace(/Saut./, 'Sauté');
  }
  return name;
}

// ---- Stations ----
const stationsRaw = sheetToJson('Stations') || [];
const stations = stationsRaw
  .filter(r => r['Station'] && isFood(r['Station']))
  .map(r => ({
    station: normName(r['Station']),
    count: r['Count'] || 0,
    avg_sec: r['Avg Seconds'] || 0,
    exp_sec: r['Expected Avg Seconds (Target)'] || 0,
  }));

// ---- Summary ----
const summaryRaw = sheetToJson('Summary') || [];
const summary = summaryRaw
  .filter(r => r['Menu Item'])
  .map(r => ({
    item: r['Menu Item'],
    count: r['Count'] || 0,
    avg_sec: r['Avg Seconds'] || 0,
  }));

// ---- Workload_DayHourly -> Fulfillment heatmap (avg fulfillment by day+hour) ----
const workloadRaw = sheetToJson('Workload_DayHourly') || [];
// Aggregate: for each day+hour, compute weighted avg fulfillment
const fulMap = {}; // {day: {hour: {sumFul, sumOcc}}}
workloadRaw.forEach(r => {
  if (!r['Day'] || !r['Hour Window']) return;
  const day = r['Day'], hr = r['Hour Window'];
  const occ = r['Occurrences'] || 0;
  const ful = r['Avg Fulfillment (min)'] || 0;
  if (!fulMap[day]) fulMap[day] = {};
  if (!fulMap[day][hr]) fulMap[day][hr] = { sumFul: 0, sumOcc: 0 };
  fulMap[day][hr].sumFul += ful * occ;
  fulMap[day][hr].sumOcc += occ;
});
const hmFul = {};
Object.keys(fulMap).forEach(day => {
  hmFul[day] = {};
  Object.keys(fulMap[day]).forEach(hr => {
    const d = fulMap[day][hr];
    hmFul[day][hr] = d.sumOcc > 0 ? +(d.sumFul / d.sumOcc).toFixed(2) : null;
  });
});

// ---- OT_DayHourly -> Guest heatmap ----
const otRaw = sheetToJson('OT_DayHourly') || [];
const hmGuests = {};
otRaw.forEach(r => {
  if (!r['Day'] || !r['Hour Window']) return;
  const guests = r['Avg Concurrent Guests'];
  if (!guests || guests === '' || Number(guests) === 0) return;
  const day = r['Day'], hr = r['Hour Window'];
  if (!hmGuests[day]) hmGuests[day] = {};
  hmGuests[day][hr] = +Number(guests).toFixed(1);
});

// ---- Workload_Overall -> CURVE and TBK (bucketed) ----
const workloadOverallRaw = sheetToJson('Workload_Overall') || [];
const curve = workloadOverallRaw
  .filter(r => r['Concurrent Tickets'] != null && r['Occurrences'] != null)
  .map(r => ({
    conc: r['Concurrent Tickets'],
    occ: r['Occurrences'],
    ful: r['Avg Fulfillment (min)'] || 0,
    guests: r['Avg Guests Seated'] || 0,
  }))
  .filter(r => r.conc > 0);

const tbk = workloadOverallRaw
  .filter(r => r['Tickets Open (bucket)'] && r['Avg Fulfillment (min)_2'] != null)
  .map(r => ({
    bucket: r['Tickets Open (bucket)'],
    ful: r['Avg Fulfillment (min)_2'],
  }));

// Compute breaking point: first concurrent count where avg fulfillment > 15 min
const breakingPointRow = curve.find(r => r.ful > 15);
const breakingPoint = breakingPointRow ? breakingPointRow.conc : null;
const breakingPointGuests = breakingPointRow ? Math.round(breakingPointRow.guests) : null;

console.log('Breaking point (tickets):', breakingPoint);
console.log('Breaking point (guests):', breakingPointGuests);

// ---- Ticket Drop -> items per station ----
const ticketDropRaw = sheetToJson('ticket drop') || [];
// Build: for each food station, count items and avg seconds
// We need to parse fulfillment time from the ticket drop
// Each row has: Station, Fulfillment Time (text), Menu Item 1..11
// Fulfillment Time is like "6 minutes and 20 seconds"
function parseFulTime(str) {
  if (!str) return null;
  const mMatch = str.match(/(\d+)\s*minute/);
  const sMatch = str.match(/(\d+)\s*second/);
  const m = mMatch ? parseInt(mMatch[1]) : 0;
  const s = sMatch ? parseInt(sMatch[1]) : 0;
  return m * 60 + s;
}

// Build stationItems: {stationName: {itemName: {count, totalSec}}}
const stationItems = {};
ticketDropRaw.forEach(r => {
  const station = normName(r['Station']);
  if (!station || !isFood(station)) return;
  const fulSec = parseFulTime(r['Fulfillment Time']);
  if (!stationItems[station]) stationItems[station] = {};
  // collect all menu items from columns
  for (let i = 1; i <= 11; i++) {
    const item = r[`Menu Item ${i}`];
    if (!item) continue;
    if (!stationItems[station][item]) stationItems[station][item] = { count: 0, totalSec: 0 };
    stationItems[station][item].count++;
    if (fulSec != null) stationItems[station][item].totalSec += fulSec;
  }
});
// Convert to arrays
const stationItemsArr = {};
Object.keys(stationItems).forEach(st => {
  stationItemsArr[st] = Object.entries(stationItems[st])
    .map(([item, d]) => ({
      item,
      count: d.count,
      avg_sec: d.count > 0 ? +(d.totalSec / d.count).toFixed(1) : 0,
    }))
    .sort((a,b) => b.count - a.count);
});

// ---- Station_* tabs -> day x hour heatmaps + breaking point ----
const allSheets = wb.SheetNames;
const stationTabs = allSheets.filter(s => s.startsWith('Station_'));
const stationDetails = {}; // {stationName: {byDayHour: {day: {hr: {count,avg_sec,exp_sec}}}, allRows: [...]}}

stationTabs.forEach(tabName => {
  const stName = normName(tabName.replace('Station_', ''));
  if (!isFood(stName)) return;
  const rows = sheetToJson(tabName) || [];
  // Group by day and hour
  const byDayHour = {};
  const allRows = [];
  rows.forEach(r => {
    if (!r['Day'] || !r['Hour Window']) return;
    const day = r['Day'], hr = r['Hour Window'];
    const count = r['Count'] || 0;
    const avg_sec = r['Avg Seconds'] || 0;
    const exp_sec = r['Expected Avg Seconds (Target)'] || 0;
    allRows.push({ day, hr, count, avg_sec, exp_sec });
    if (!byDayHour[day]) byDayHour[day] = {};
    byDayHour[day][hr] = { count, avg_sec, exp_sec };
  });
  // Also compute hourly avg (across all days)
  const byHour = {};
  rows.forEach(r => {
    if (!r['Hour Window']) return;
    const hr = r['Hour Window'];
    const count = r['Count'] || 0;
    const avg_sec = r['Avg Seconds'] || 0;
    const exp_sec = r['Expected Avg Seconds (Target)'] || 0;
    if (!byHour[hr]) byHour[hr] = { totalWeighted: 0, totalCount: 0, exp_sec: 0 };
    byHour[hr].totalWeighted += avg_sec * count;
    byHour[hr].totalCount += count;
    if (exp_sec > 0) byHour[hr].exp_sec = exp_sec;
  });
  const hourly = {};
  Object.keys(byHour).forEach(hr => {
    const d = byHour[hr];
    hourly[hr] = {
      avg_sec: d.totalCount > 0 ? +(d.totalWeighted / d.totalCount).toFixed(1) : 0,
      exp_sec: d.exp_sec,
    };
  });
  // Breaking point: find rows where avg_sec > 900 grouped by count (if available) or by hour
  // Use allRows sorted by count
  // The station detail rows are grouped by Day+Hour, not concurrent count
  // Find "breaking" hours: hours where avg_sec > 900
  const breakingHours = allRows.filter(r => r.avg_sec > 900 && r.count > 0);
  stationDetails[stName] = { byDayHour, hourly, allRows, breakingHours };
});

const output = {
  stations,
  summary,
  hmFul,
  hmGuests,
  curve,
  tbk,
  breakingPoint,
  breakingPointGuests,
  stationItemsArr,
  stationDetails: Object.fromEntries(
    Object.entries(stationDetails).map(([k, v]) => [k, {
      hourly: v.hourly,
      byDayHour: v.byDayHour,
      breakingHours: v.breakingHours.slice(0, 20),
    }])
  ),
};

const fs = require('fs');
fs.writeFileSync(require('path').join(__dirname, 'dashboard-data.json'), JSON.stringify(output), 'utf8');
console.log('Data written to dashboard-data.json');
