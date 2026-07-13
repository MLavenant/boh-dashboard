import XLSX from "xlsx";
import fs from "fs";

const wb = XLSX.readFile("c:\\Dell\\data extraction125 claudie.xlsx");

// ── REF sheet (menu item → station mapping) ──────────────────────────────────
const ref = wb.Sheets["ref"];
const refData = XLSX.utils.sheet_to_json(ref, { header: 1, defval: "" });
// Find the actual header row (row 7 based on previous output)
const headerRow = refData[7]; // ["Menu Items","Stations 1","Stations 2",...,"Target"]
console.log("REF header:", JSON.stringify(headerRow));
const refRows = refData.slice(8).filter(r => r[0]);
console.log(`REF rows: ${refRows.length}`);
refRows.slice(0, 15).forEach(r => console.log(" ", JSON.stringify(r.slice(0, 13))));

// ── TARGET sheet ──────────────────────────────────────────────────────────────
const target = wb.Sheets["TARGET"];
const targetData = XLSX.utils.sheet_to_json(target, { header: 1, defval: "" });
// Find data rows
const targetHeader = targetData[2]; // ["Menu Items","Prep Time"]
console.log("\nTARGET header:", JSON.stringify(targetHeader));
const targetRows = targetData.slice(3).filter(r => r[0]);
console.log(`TARGET rows: ${targetRows.length}`);
targetRows.slice(0, 20).forEach(r => console.log(" ", JSON.stringify(r)));

// Save ref data as JSON for dashboard use
const refJson = refRows.map(r => ({
  item: r[0],
  stations: [r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10]].filter(s => s && s !== ""),
  target: r[11],
}));

const targetJson = targetRows.reduce((acc, r) => {
  if (r[0] && r[1]) acc[r[0]] = r[1];
  return acc;
}, {});

fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\claudie-ref.json", JSON.stringify({ ref: refJson, targets: targetJson }, null, 2));
console.log("\nSaved claudie-ref.json");

// Also show unique stations
const allStations = [...new Set(refJson.flatMap(r => r.stations))].sort();
console.log("\nUnique stations:", allStations);

// Show sample ticket drop data with parsed dates
const ticketWb = wb.Sheets["ticket drop"];
const ticketData = XLSX.utils.sheet_to_json(ticketWb, { header: 1, defval: "" });
console.log("\n\nTicket drop sample (parsed):");
ticketData.slice(1, 5).forEach(r => {
  const checkOpened = XLSX.SSF.format("yyyy-mm-dd hh:mm", r[5]);
  const fired = XLSX.SSF.format("yyyy-mm-dd hh:mm", r[8]);
  const fulfilled = XLSX.SSF.format("yyyy-mm-dd hh:mm", r[9]);
  console.log(`  Station: ${r[6]} | CheckOpened: ${checkOpened} | Fired: ${fired} | Fulfilled: ${fulfilled} | Time: ${r[10]}`);
});
