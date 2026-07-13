const XLSX = require('C:/Cursor/toast-mcp-server/node_modules/xlsx');

// 1. Read REF tab from BOH Dashboard
const bohFile = 'C:/Users/MatthiasLavenant/mila-group.com/Riviera Dining Group Current - CEO DASHBOARD/OPERATIONS DASHBOARD/ops/AVA/AVA WP - BOH DASHBOARD.xlsx';
const wb = XLSX.readFile(bohFile);

console.log('=== REF tab ===');
const refSheet = wb.Sheets['REF'];
const refData = XLSX.utils.sheet_to_json(refSheet, { header: 1 });
console.log(JSON.stringify(refData.slice(0, 50), null, 2));

console.log('\n=== STATIONS DROP tab (first 30 rows) ===');
const stDropSheet = wb.Sheets['STATIONS DROP'];
const stDropData = XLSX.utils.sheet_to_json(stDropSheet, { header: 1 });
console.log(JSON.stringify(stDropData.slice(0, 30), null, 2));

// 2. Read Week20 Stations tab
console.log('\n=== Week20 Stations tab ===');
const wb2 = XLSX.readFile('c:/Dell/Week 20avawptest.xlsx');
const stSheet = wb2.Sheets['Stations'];
const stData = XLSX.utils.sheet_to_json(stSheet, { header: 1 });
console.log(JSON.stringify(stData.slice(0, 40), null, 2));
