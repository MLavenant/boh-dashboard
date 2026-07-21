'use strict';
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const OUT_PATH = path.join(__dirname, 'item-targets.json');

function readClaudie() {
  const filePath = 'C:/Dell/data extraction125 claudie.xlsx';
  if (!fs.existsSync(filePath)) { console.warn('Claudie file not found'); return {}; }
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets['TARGET'];
  if (!ws) { console.warn('Claudie: TARGET sheet not found'); return {}; }
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
  // Headers at row index 2: ["Menu Items", "Prep Time"]
  // Data starts at row index ~8 (first non-empty after headers)
  const result = {};
  let headerFound = false;
  for (const row of rows) {
    if (!headerFound) {
      if (row[0] === 'Menu Items') { headerFound = true; }
      continue;
    }
    const item = row[0];
    const prepMin = row[1];
    if (item && typeof item === 'string' && item.trim() && typeof prepMin === 'number' && prepMin > 0) {
      result[item.trim()] = Math.round(prepMin * 60);
    }
  }
  console.log(`Claudie: ${Object.keys(result).length} items extracted`);
  return result;
}

function readRefSheet(filePath, venueName) {
  if (!fs.existsSync(filePath)) { console.warn(`${venueName} file not found: ${filePath}`); return {}; }
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets['REF'] || wb.Sheets['ref'] || wb.Sheets['Ref'];
  if (!ws) { console.warn(`${venueName}: REF sheet not found`); return {}; }
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
  // Find header row with "Menu Items" and "Prep Time"
  let headerRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === 'Menu Items' && rows[i][7] === 'Prep Time') {
      headerRowIdx = i;
      break;
    }
    // Also match if Prep Time is at index 7 and first col has menu items label
    if (String(rows[i][0] || '').includes('Menu Item') || String(rows[i][7] || '').includes('Prep')) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx < 0) { console.warn(`${venueName}: Could not find header row`); return {}; }
  const result = {};
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const item = row[0];
    const prepMin = row[7];
    if (item && typeof item === 'string' && item.trim() && item.trim() !== '' && typeof prepMin === 'number' && prepMin > 0) {
      const cleanItem = item.trim().replace(/^\r\n/, '').replace(/\r\n/g, ' ').trim();
      if (cleanItem) result[cleanItem] = Math.round(prepMin * 60);
    }
  }
  console.log(`${venueName}: ${Object.keys(result).length} items extracted`);
  return result;
}

function readCasaNeos() {
  const filePath = 'C:/Dell/data extraction100 casa neos.xlsx';
  if (!fs.existsSync(filePath)) { console.warn('Casa Neos file not found'); return {}; }
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets['ref'] || wb.Sheets['REF'];
  if (!ws) { console.warn('Casa Neos: ref sheet not found'); return {}; }
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
  let headerRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === 'Menu Items' && String(rows[i][1] || '').includes('Stations')) {
      headerRowIdx = i; break;
    }
  }
  if (headerRowIdx < 0) { console.warn('Casa Neos: header not found'); return {}; }
  const result = {};
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const item = row[0];
    const prepMin = row[10];
    if (item && typeof item === 'string' && item.trim() && typeof prepMin === 'number' && prepMin > 0) {
      const cleanItem = item.trim().replace(/^\r\n/, '').replace(/\r\n/g, ' ').trim();
      if (cleanItem) result[cleanItem] = Math.round(prepMin * 60);
    }
  }
  console.log(`Casa Neos: ${Object.keys(result).length} items extracted`);
  return result;
}

function readTargetItemsTargets(filePath, sheetName, venueName) {
  if (!fs.existsSync(filePath)) { console.warn(`${venueName} file not found`); return {}; }
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[sheetName];
  if (!ws) { console.warn(`${venueName}: sheet missing`); return {}; }
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (!rows.length) return {};
  const hdr = rows[0].map(h => String(h || '').trim());
  const targetCol = hdr.findIndex(h => /^target$/i.test(h));
  if (targetCol < 0) return {};
  const result = {};
  for (let i = 1; i < rows.length; i++) {
    const item = String(rows[i][0] || '').replace(/\u00a0/g, ' ').trim();
    const prepMin = rows[i][targetCol];
    if (item && typeof prepMin === 'number' && prepMin > 0) {
      result[item] = Math.round(prepMin * 60);
    }
  }
  console.log(`${venueName}: ${Object.keys(result).length} items extracted`);
  return result;
}

const TARGET_ITEMS_XLSX = path.join(__dirname, 'data', 'Target items.xlsx');

const targets = {
  claudie: readClaudie(),
  casa_neos: readCasaNeos(),
  ava_cg: readTargetItemsTargets(TARGET_ITEMS_XLSX, 'AVA CG', 'AVA CG'),
  ava_wp: readTargetItemsTargets(TARGET_ITEMS_XLSX, 'AVA WP', 'AVA WP'),
  mila: {}, // not ready yet
};

fs.writeFileSync(OUT_PATH, JSON.stringify(targets, null, 2));
console.log(`✅ Written: ${OUT_PATH}`);
console.log('Counts:', Object.fromEntries(Object.entries(targets).map(([k,v])=>[k,Object.keys(v).length])));
