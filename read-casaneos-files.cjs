const path = require('path');
const XLSX = require(path.join(__dirname, 'node_modules/xlsx'));

function inspectFile(filePath) {
  console.log('\n' + '='.repeat(70));
  console.log('FILE:', filePath);
  console.log('='.repeat(70));
  let wb;
  try {
    wb = XLSX.readFile(filePath);
  } catch(e) {
    console.log('ERROR reading file:', e.message);
    return;
  }
  console.log('Sheet names:', wb.SheetNames);
  wb.SheetNames.forEach(name => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
    console.log('\n--- Sheet:', name, '(' + rows.length + ' rows) ---');
    if (rows.length > 0) {
      console.log('Columns:', Object.keys(rows[0]));
      console.log('First 3 rows:');
      rows.slice(0, 3).forEach((r, i) => console.log('  [' + i + ']', JSON.stringify(r)));
    } else {
      console.log('(empty)');
    }
  });
}

inspectFile('C:\\Dell\\Week 20cntest.xlsx');
