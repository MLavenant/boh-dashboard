import XLSX from "xlsx";

const wb = XLSX.readFile("C:\\Dell\\Week 20cl2.xlsx");

// ---- Workload_Overall: all 57 rows ----
const ws_wo = wb.Sheets["Workload_Overall"];
const wo = XLSX.utils.sheet_to_json(ws_wo, { defval: null });
const curve = wo.filter(r => r["Concurrent Tickets"] != null).map(r => ({
  conc: r["Concurrent Tickets"],
  occ: r["Occurrences"],
  ful: r["Avg Fulfillment (min)"],
  guests: r["Avg Guests Seated"]
}));
console.log("CURVE_JSON=" + JSON.stringify(curve));

// Ticket buckets
const tbk = wo.filter(r => r["Tickets Open (bucket)"] != null).map(r => ({
  bucket: r["Tickets Open (bucket)"],
  ful: r["Avg Fulfillment (min)_2"]
}));
console.log("TBK_JSON=" + JSON.stringify(tbk));

// Guest buckets
const gbk = wo.filter(r => r["Avg Guests Seated_1"] != null).map(r => ({
  bucket: r["Avg Guests Seated_1"],
  ful: r["Avg Fulfillment (min)_1"]
}));
console.log("GBK_JSON=" + JSON.stringify(gbk));

// ---- Workload_DayHourly: compute avg concurrent per day+hour ----
const ws_wdh = wb.Sheets["Workload_DayHourly"];
const wdh = XLSX.utils.sheet_to_json(ws_wdh, { defval: null });

// For Visual 1: avg concurrent tickets per (day, hour)
const dayHourMap = {};
for (const r of wdh) {
  const day = r["Day"], hw = r["Hour Window"], conc = r["Concurrent Tickets Open"], occ = r["Occurrences"];
  if (!day || !hw || conc == null) continue;
  const key = day + "|" + hw;
  if (!dayHourMap[key]) dayHourMap[key] = { sumWeighted: 0, totalOcc: 0 };
  dayHourMap[key].sumWeighted += conc * occ;
  dayHourMap[key].totalOcc += occ;
}
// Build per-day per-hour avg concurrent
const DAY_ORDER = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const ALL_HOURS = [...new Set(wdh.map(r => r["Hour Window"]).filter(Boolean))].sort((a,b) => {
  return parseInt(a) - parseInt(b);
});
const pressureByDay = {};
for (const [key, val] of Object.entries(dayHourMap)) {
  const [day, hw] = key.split("|");
  if (!pressureByDay[day]) pressureByDay[day] = {};
  pressureByDay[day][hw] = val.totalOcc > 0 ? Math.round(val.sumWeighted / val.totalOcc * 100) / 100 : 0;
}
console.log("HOURS_JSON=" + JSON.stringify(ALL_HOURS));
console.log("PRESSURE_JSON=" + JSON.stringify(pressureByDay));

// Week average
const weekAvg = {};
for (const hw of ALL_HOURS) {
  let sum = 0, cnt = 0;
  for (const day of DAY_ORDER) {
    const v = pressureByDay[day] && pressureByDay[day][hw];
    if (v != null) { sum += v; cnt++; }
  }
  weekAvg[hw] = cnt > 0 ? Math.round(sum / cnt * 100) / 100 : null;
}
console.log("WEEK_AVG_JSON=" + JSON.stringify(weekAvg));
