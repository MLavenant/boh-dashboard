const XLSX = require('C:/Cursor/toast-mcp-server/node_modules/xlsx');

function sheetToRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}

// ─── 1. REF tab from data extraction file ───────────────────────────────────
const rawWb = XLSX.readFile('c:/Dell/data extraction101 ava cg.xlsx');
console.log('\n=== data extraction101 ava cg.xlsx ===');
console.log('Sheets:', rawWb.SheetNames);

// REF tab
const refSheet = rawWb.Sheets['ref'];
if (refSheet) {
  const rows = sheetToRows(refSheet);
  console.log('\n--- ref tab (raw rows 0-30) ---');
  rows.slice(0, 30).forEach((r, i) => console.log(i, JSON.stringify(r)));
}

// TARGET tab
const targetSheet = rawWb.Sheets['TARGET'];
if (targetSheet) {
  const rows = sheetToRows(targetSheet);
  console.log('\n--- TARGET tab (raw rows 0-30) ---');
  rows.slice(0, 30).forEach((r, i) => console.log(i, JSON.stringify(r)));
}

// ─── 2. REF tab from BOH DASHBOARD ──────────────────────────────────────────
const dashWb = XLSX.readFile('C:/Users/MatthiasLavenant/mila-group.com/Riviera Dining Group Current - CEO DASHBOARD/OPERATIONS DASHBOARD/ops/AVA CG/AVA CG - BOH DASHBOARD.xlsx');
console.log('\n\n=== AVA CG - BOH DASHBOARD.xlsx REF tab ===');
const dashRef = dashWb.Sheets['REF'];
if (dashRef) {
  const rows = sheetToRows(dashRef);
  console.log('Total rows:', rows.length);
  rows.slice(0, 60).forEach((r, i) => console.log(i, JSON.stringify(r)));
}

// ─── 3. Week 20 - Stations tab ───────────────────────────────────────────────
const w20Wb = XLSX.readFile('c:/Dell/Week 20avacgtest.xlsx');
console.log('\n\n=== Week 20avacgtest.xlsx - Stations tab ===');
const stationsSheet = w20Wb.Sheets['Stations'];
if (stationsSheet) {
  const rows = sheetToRows(stationsSheet);
  console.log('Total rows:', rows.length);
  rows.slice(0, 50).forEach((r, i) => console.log(i, JSON.stringify(r)));
}

// Summary tab
console.log('\n\n=== Week 20avacgtest.xlsx - Summary tab ===');
const summarySheet = w20Wb.Sheets['Summary'];
if (summarySheet) {
  const rows = sheetToRows(summarySheet);
  rows.slice(0, 40).forEach((r, i) => console.log(i, JSON.stringify(r)));
}
