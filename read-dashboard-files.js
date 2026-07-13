import XLSX from "xlsx";

// Read Week 20cl2.xlsx
const wb = XLSX.readFile("C:\\Dell\\Week 20cl2.xlsx");
console.log("=== Week 20cl2 sheet names ===", wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json(ws, { defval: null });
  console.log(`\n--- Sheet: ${name} (${data.length} rows) ---`);
  if (data.length > 0) console.log("Columns:", Object.keys(data[0]));
  console.log("First 3 rows:", JSON.stringify(data.slice(0, 3), null, 2).slice(0, 1500));
}

// Read data extraction125 claudie.xlsx
const wb2 = XLSX.readFile("C:\\Dell\\data extraction125 claudie.xlsx");
console.log("\n=== data extraction125 sheet names ===", wb2.SheetNames);
for (const name of wb2.SheetNames) {
  const ws = wb2.Sheets[name];
  const data = XLSX.utils.sheet_to_json(ws, { defval: null });
  console.log(`\n--- Sheet: ${name} (${data.length} rows) ---`);
  if (data.length > 0) console.log("Columns:", Object.keys(data[0]));
  console.log("First 2 rows:", JSON.stringify(data.slice(0, 2), null, 2).slice(0, 1000));
}
