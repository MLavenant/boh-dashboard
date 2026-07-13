import XLSX from "xlsx";

const wb = XLSX.readFile("C:\\Dell\\Week 20cl2.xlsx");

// Workload_DayHourly
const ws1 = wb.Sheets["Workload_DayHourly"];
const wdh = XLSX.utils.sheet_to_json(ws1, { defval: null });
console.log("=== Workload_DayHourly ===", wdh.length, "rows");
console.log("Columns:", Object.keys(wdh[0] || {}));
console.log("First 10:", JSON.stringify(wdh.slice(0, 10), null, 2));

// Workload_Overall - read with header: 1 to see raw
const ws2 = wb.Sheets["Workload_Overall"];
const wo = XLSX.utils.sheet_to_json(ws2, { defval: null });
console.log("\n=== Workload_Overall ===", wo.length, "rows");
console.log("Columns:", Object.keys(wo[0] || {}));
console.log("First 10:", JSON.stringify(wo.slice(0, 10), null, 2));

// OT_DayHourly - get active hours data
const ws3 = wb.Sheets["OT_DayHourly"];
const otdh = XLSX.utils.sheet_to_json(ws3, { defval: null });
// Show peak hours
const peak = otdh.filter(r => r["Avg Concurrent Guests"] > 50);
console.log("\n=== OT_DayHourly peak rows (>50 guests) ===", peak.length);
console.log(JSON.stringify(peak.slice(0, 20), null, 2));

// Stations summary for targets
const ws4 = wb.Sheets["Stations"];
const stations = XLSX.utils.sheet_to_json(ws4, { defval: null });
console.log("\n=== Stations ===");
console.log(JSON.stringify(stations, null, 2));
