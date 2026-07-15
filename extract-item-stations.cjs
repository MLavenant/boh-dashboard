'use strict';
/**
 * Extract static Menu Item → Stations + Target from venue REF Excel sheets.
 * This is the authoritative assignment used by Stations / Menu Items / Assignment tabs.
 */
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const OUT = path.join(__dirname, 'item-station-map.json');

function clean(s) {
  return String(s || '')
    .replace(/^\r\n/, '')
    .replace(/\r\n/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function isFoodStationName(name) {
  const n = clean(name).toLowerCase();
  if (!n) return false;
  return !['bar', 'champagne', 'wine', 'btg', 'pos', 'barista', 'somm', 'water', 'service', 'beach', 'btl'].some(p => n.includes(p));
}

/** Read Claudie ref + TARGET sheets */
function readClaudie() {
  const filePath = 'C:/Dell/data extraction125 claudie.xlsx';
  if (!fs.existsSync(filePath)) { console.warn('Claudie file missing'); return {}; }
  const wb = xlsx.readFile(filePath);

  // Prep times from TARGET
  const tgtRows = xlsx.utils.sheet_to_json(wb.Sheets['TARGET'], { header: 1, defval: null });
  const targets = {};
  let hdr = false;
  for (const row of tgtRows) {
    if (!hdr) { if (row[0] === 'Menu Items') hdr = true; continue; }
    const item = clean(row[0]);
    if (item && typeof row[1] === 'number' && row[1] > 0) targets[item] = Math.round(row[1] * 60);
  }

  // Stations from ref
  const refRows = xlsx.utils.sheet_to_json(wb.Sheets['ref'], { header: 1, defval: null });
  let headerIdx = -1;
  for (let i = 0; i < refRows.length; i++) {
    if (refRows[i][0] === 'Menu Items' && String(refRows[i][1] || '').includes('Stations')) {
      headerIdx = i; break;
    }
  }
  if (headerIdx < 0) { console.warn('Claudie: ref header not found'); return {}; }

  const result = {};
  for (let i = headerIdx + 1; i < refRows.length; i++) {
    const row = refRows[i];
    const item = clean(row[0]);
    if (!item || item === 'Menu Items') continue;
    const stations = [];
    for (let c = 1; c <= 10; c++) {
      const st = clean(row[c]);
      if (st && isFoodStationName(st) && !stations.includes(st)) stations.push(st);
    }
    // Prefer TARGET prep time; fall back to nothing
    const targetSec = targets[item] || 0;
    // Keep all REF food items even if target missing
    if (stations.length === 0 && !targets[item]) continue;
    result[item] = { stations, targetSec };
  }

  // Ensure every TARGET item appears even if not found in ref
  for (const [item, targetSec] of Object.entries(targets)) {
    if (!result[item]) result[item] = { stations: [], targetSec };
    else if (!result[item].targetSec) result[item].targetSec = targetSec;
  }

  console.log(`Claudie: ${Object.keys(result).length} items`);
  return result;
}

/** Read AVA CG / AVA WP / MILA REF sheet layout */
function readRefSheet(filePath, venueName) {
  if (!fs.existsSync(filePath)) { console.warn(`${venueName} file missing`); return {}; }
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets['REF'] || wb.Sheets['ref'] || wb.Sheets['Ref'];
  if (!ws) { console.warn(`${venueName}: REF sheet missing`); return {}; }
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });

  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === 'Menu Items' && String(rows[i][1] || '').includes('Stations')) {
      headerIdx = i; break;
    }
  }
  if (headerIdx < 0) { console.warn(`${venueName}: header not found`); return {}; }

  const result = {};
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const item = clean(row[0]);
    if (!item || item === 'Menu Items') continue;
    const stations = [];
    for (let c = 1; c <= 5; c++) {
      const st = clean(row[c]);
      if (st && isFoodStationName(st) && !stations.includes(st)) stations.push(st);
    }
    let prepMin = row[7];
    if (typeof prepMin === 'string' && prepMin.trim() && !isNaN(+prepMin)) prepMin = +prepMin;
    const targetSec = (typeof prepMin === 'number' && prepMin > 0) ? Math.round(prepMin * 60) : 0;
    if (!stations.length && !targetSec) continue;
    result[item] = { stations, targetSec };
  }
  console.log(`${venueName}: ${Object.keys(result).length} items`);
  return result;
}

const map = {
  claudie: readClaudie(),
  casa_neos: {}, // no REF sheet in CASA NEOS DASHBOARD - boh.xlsx
  ava_cg: readRefSheet(
    'C:/Users/MatthiasLavenant/mila-group.com/Riviera Dining Group Current - CEO DASHBOARD/OPERATIONS DASHBOARD/ops/AVA CG/AVA CG - BOH DASHBOARD.xlsx',
    'AVA CG'
  ),
  ava_wp: readRefSheet(
    'C:/Users/MatthiasLavenant/mila-group.com/Riviera Dining Group Current - CEO DASHBOARD/OPERATIONS DASHBOARD/ops/AVA/AVA WP - BOH DASHBOARD.xlsx',
    'AVA WP'
  ),
  mila: readRefSheet(
    'C:/Users/MatthiasLavenant/mila-group.com/Riviera Dining Group Current - CEO DASHBOARD/OPERATIONS DASHBOARD/ops/MILA/MILA - BOH DASHBOARD.xlsx',
    'MILA'
  ),
};

fs.writeFileSync(OUT, JSON.stringify(map, null, 2));
console.log('✅ Written', OUT);
console.log('Counts:', Object.fromEntries(Object.entries(map).map(([k, v]) => [k, Object.keys(v).length])));
