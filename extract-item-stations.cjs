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
  if (/^station\s*\d+$/i.test(n)) return false;
  return !['bar', 'champagne', 'wine', 'btg', 'pos', 'barista', 'somm', 'water', 'service', 'beach', 'btl', 'drink'].some(p => n.includes(p));
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

/** Read Casa Neos ref sheet (stations 1–9, Target in col 10). */
function readCasaNeos() {
  const filePath = 'C:/Dell/data extraction100 casa neos.xlsx';
  if (!fs.existsSync(filePath)) { console.warn('Casa Neos file missing'); return {}; }
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets['ref'] || wb.Sheets['REF'];
  if (!ws) { console.warn('Casa Neos: ref sheet missing'); return {}; }
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });

  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === 'Menu Items' && String(rows[i][1] || '').includes('Stations')) {
      headerIdx = i; break;
    }
  }
  if (headerIdx < 0) { console.warn('Casa Neos: ref header not found'); return {}; }

  const result = {};
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const item = clean(row[0]);
    if (!item || item === 'Menu Items') continue;
    const stations = [];
    for (let c = 1; c <= 9; c++) {
      const st = clean(row[c]);
      if (st && isFoodStationName(st) && !stations.includes(st)) stations.push(st);
    }
    let prepMin = row[10];
    if (typeof prepMin === 'string' && prepMin.trim() && !isNaN(+prepMin)) prepMin = +prepMin;
    const targetSec = (typeof prepMin === 'number' && prepMin > 0) ? Math.round(prepMin * 60) : 0;
    if (!stations.length && !targetSec) continue;
    result[item] = { stations, targetSec };
  }
  console.log(`Casa Neos: ${Object.keys(result).length} items`);
  return result;
}

/**
 * Read AVA CG / AVA WP from Toast-export style "Target items.xlsx".
 * Layout: col0 = name, Target col, Station 1..N columns.
 * Skips menu/group headers; keeps real menu items only.
 */
function readTargetItemsSheet(filePath, sheetName, venueName) {
  if (!fs.existsSync(filePath)) { console.warn(`${venueName} file missing: ${filePath}`); return {}; }
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[sheetName];
  if (!ws) { console.warn(`${venueName}: sheet "${sheetName}" missing`); return {}; }
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (!rows.length) return {};

  const hdr = rows[0].map(h => clean(h));
  const targetCol = hdr.findIndex(h => /^target$/i.test(h));
  const stationCols = hdr
    .map((h, i) => (/^station\s*\d+$/i.test(h) ? i : -1))
    .filter(i => i >= 0);
  if (targetCol < 0 || !stationCols.length) {
    console.warn(`${venueName}: Target/Station columns not found in ${sheetName}`);
    return {};
  }

  const SKIP = /^(groups|items|modifier groups|add options|food prep|dinner food menu|lunch|brunch menu|food|wine|drink|private event menus|golden hour menu|dessert|pasta\s*&\s*risotto)$/i;
  const result = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const item = clean(row[0]);
    if (!item || SKIP.test(item)) continue;

    let prepMin = row[targetCol];
    if (typeof prepMin === 'string' && prepMin.trim() && !isNaN(+prepMin)) prepMin = +prepMin;
    const targetSec = (typeof prepMin === 'number' && prepMin > 0) ? Math.round(prepMin * 60) : 0;

    const stations = [];
    for (const c of stationCols) {
      const st = clean(row[c]);
      if (st && isFoodStationName(st) && !stations.includes(st)) stations.push(st);
    }

    // Keep targeted items, or hyphenated SKUs with stations (e.g. ACG- / A- / MMA-)
    const looksLikeItem = /[-]/.test(item) || /^(A-|ACG-|AVACG-|MMA-|MM\s)/i.test(item);
    if (!targetSec && !(stations.length && looksLikeItem)) continue;
    if (!stations.length && !targetSec) continue;

    result[item] = { stations, targetSec };
  }
  const withTarget = Object.values(result).filter(v => v.targetSec > 0).length;
  console.log(`${venueName}: ${Object.keys(result).length} items (${withTarget} with target) from ${sheetName}`);
  return result;
}

const TARGET_ITEMS_XLSX = path.join(__dirname, 'data', 'Target items.xlsx');

const map = {
  claudie: readClaudie(),
  casa_neos: readCasaNeos(),
  ava_cg: readTargetItemsSheet(TARGET_ITEMS_XLSX, 'AVA CG', 'AVA CG'),
  ava_wp: readTargetItemsSheet(TARGET_ITEMS_XLSX, 'AVA WP', 'AVA WP'),
  mila: {}, // MILA REF not ready yet — do not use old BOH dashboard copy
};

fs.writeFileSync(OUT, JSON.stringify(map, null, 2));
console.log('✅ Written', OUT);
console.log('Counts:', Object.fromEntries(Object.entries(map).map(([k, v]) => [k, Object.keys(v).length])));

/** Merge Toast Bulk Editor prep stations — stations only, never targetSec from REF. */
function mergeToastPrep(venueKey, minItems = 5) {
  const prepFile = path.join(__dirname, 'data', `prep-stations-${venueKey}.json`);
  if (!fs.existsSync(prepFile)) {
    console.log(`No ${venueKey} Toast prep scrape yet — skip`);
    return;
  }
  const prep = JSON.parse(fs.readFileSync(prepFile, 'utf8'));
  const items = prep.items || [];
  if (items.length < minItems) {
    console.warn(`${venueKey} prep scrape incomplete (${items.length}) — skip merge`);
    return;
  }
  if (!map[venueKey]) map[venueKey] = {};
  let added = 0, updated = 0;
  for (const it of items) {
    const name = clean(it.menuItem);
    if (!name) continue;
    const stations = (it.stations || []).map(clean).filter(isFoodStationName).filter(s => !/^\d{10,}$/.test(s));
    if (!stations.length) continue;
    const existing = map[venueKey][name];
    if (!existing) {
      map[venueKey][name] = { stations, targetSec: 0, source: 'toast-bulkeditor' };
      added++;
      continue;
    }
    map[venueKey][name] = {
      stations,
      targetSec: existing.targetSec || 0,
      source: existing.targetSec ? 'ref+toast' : (existing.source || 'toast-bulkeditor'),
    };
    updated++;
  }
  console.log(`${venueKey} Toast prep: +${added} new, ${updated} routes (REF targets preserved)`);
}

for (const v of ['claudie', 'ava_cg', 'ava_wp', 'casa_neos']) {
  mergeToastPrep(v, v === 'casa_neos' ? 1 : 5);
}

/** Chef-edited fulfillment targets (minutes→sec). Applied after REF; scrape never touches these. */
function applyChefTargetOverrides() {
  const f = path.join(__dirname, 'chef-target-overrides.json');
  if (!fs.existsSync(f)) return;
  const overrides = JSON.parse(fs.readFileSync(f, 'utf8'));
  let n = 0;
  for (const [venue, items] of Object.entries(overrides)) {
    if (!map[venue]) map[venue] = {};
    for (const [item, val] of Object.entries(items || {})) {
      const sec = typeof val === 'number' ? val : (typeof val === 'object' && val?.targetSec ? val.targetSec : 0);
      if (!sec || sec <= 0) continue;
      if (!map[venue][item]) map[venue][item] = { stations: [], targetSec: 0 };
      map[venue][item].targetSec = Math.round(sec);
      map[venue][item].targetSource = 'chef';
      n++;
    }
  }
  if (n) console.log(`Chef target overrides applied: ${n} items`);
}

applyChefTargetOverrides();
fs.writeFileSync(OUT, JSON.stringify(map, null, 2));
console.log('Final counts:', Object.fromEntries(Object.entries(map).map(([k, v]) => [k, Object.keys(v).length])));
