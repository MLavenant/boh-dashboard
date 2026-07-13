const path = require('path');
const XLSX = require(path.join(__dirname, 'node_modules/xlsx'));

const EXCEL_PATH = 'C:\\Dell\\Week 20cntest.xlsx';
const wb = XLSX.readFile(EXCEL_PATH);

function sheetToJson(name) {
  if (!wb.SheetNames.includes(name)) return null;
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
}

// Casa Neos specific exclusions
const EXCLUDE_WORDS = ['bar', 'champagne', 'btg', 'barista', 'pos', 'somm', 'water', 'rpfl', 'rp beach', 'sp beach', 'fl 1 sv', 'fl 2 sv', 'fl 2 svc', 'fl beach'];
function isFood(name) {
  if (!name) return false;
  const low = name.toLowerCase();
  return !EXCLUDE_WORDS.some(w => low.includes(w));
}

// ---- Stations ----
const stationsRaw = sheetToJson('Stations') || [];
const stations = stationsRaw
  .filter(r => r['Station'] && isFood(r['Station']))
  .map(r => ({
    station: r['Station'],
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

// ---- Workload_DayHourly -> Fulfillment heatmap ----
const workloadRaw = sheetToJson('Workload_DayHourly') || [];
const fulMap = {};
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
// Guest count at breaking point
const bpGuestsRow = breakingPointRow ? breakingPointRow : null;
const breakingPointGuests = bpGuestsRow ? Math.round(bpGuestsRow.guests) : null;

console.log('Breaking point (tickets):', breakingPoint);
console.log('Breaking point (guests):', breakingPointGuests);
console.log('Curve rows:', curve.length);
console.log('TBK rows:', tbk.length);

// ---- Ticket Drop -> items per station ----
const ticketDropRaw = sheetToJson('ticket drop') || [];
function parseFulTime(str) {
  if (!str) return null;
  const mMatch = str.match(/(\d+)\s*minute/);
  const sMatch = str.match(/(\d+)\s*second/);
  const hMatch = str.match(/(\d+)\s*hour/);
  const h = hMatch ? parseInt(hMatch[1]) : 0;
  const m = mMatch ? parseInt(mMatch[1]) : 0;
  const s = sMatch ? parseInt(sMatch[1]) : 0;
  const total = h * 3600 + m * 60 + s;
  // Filter out outliers > 2 hours (likely data quality issue)
  return total > 7200 ? null : total;
}

const stationItems = {};
ticketDropRaw.forEach(r => {
  const station = r['Station'];
  if (!station || !isFood(station)) return;
  const fulSec = parseFulTime(r['Fulfillment Time']);
  if (!stationItems[station]) stationItems[station] = {};
  for (let i = 1; i <= 11; i++) {
    const item = r[`Menu Item ${i}`];
    if (!item) continue;
    if (!stationItems[station][item]) stationItems[station][item] = { count: 0, totalSec: 0 };
    stationItems[station][item].count++;
    if (fulSec != null) stationItems[station][item].totalSec += fulSec;
  }
});
const stationItemsArr = {};
Object.keys(stationItems).forEach(st => {
  stationItemsArr[st] = Object.entries(stationItems[st])
    .map(([item, d]) => ({
      item,
      count: d.count,
      avg_sec: d.count > 0 ? +(d.totalSec / d.count).toFixed(1) : 0,
    }))
    .sort((a, b) => b.count - a.count);
});

// ---- Station_* tabs ----
const allSheets = wb.SheetNames;
const stationTabs = allSheets.filter(s => s.startsWith('Station_'));
const stationDetails = {};

stationTabs.forEach(tabName => {
  const stName = tabName.replace('Station_', '');
  if (!isFood(stName)) return;
  const rows = sheetToJson(tabName) || [];
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

console.log('Food stations:', stations.map(s => s.station));
console.log('Summary items:', summary.length);

const fs = require('fs');
fs.writeFileSync(require('path').join(__dirname, 'casaneos-data.json'), JSON.stringify(output), 'utf8');
console.log('Data written to casaneos-data.json');
