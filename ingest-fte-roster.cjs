/**
 * Ingest weekly FTE roster → data/fte/fte-roster-{week}.json (food-production families only).
 *
 * Preferred source (Viktor Ops FTE export):
 *   People tab — Name, Location, FOH/BOH, Position
 *   e.g. RDG_FTE_Week_34_summary.xlsx
 *
 * Legacy source (ADP dump):
 *   Data - Overall — Payroll Company Code + Matrix
 *   e.g. RDG_FTE_Week_30.xlsx
 *
 * Usage:
 *   node ingest-fte-roster.cjs [path-to.xlsx] [weekLabel]
 *   node ingest-fte-roster.cjs data/fte/RDG_FTE_Week_34_summary.xlsx 2026-W34
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const {
  CODE_TO_VENUE,
  LOCATION_TO_VENUE,
  normalizeFoodFamily,
} = require('./boh-staffing-shared.cjs');

const ROOT = process.env.BOH_ROOT || __dirname;
const FTE_DIR = path.join(ROOT, 'data', 'fte');

function inferWeekFromFilename(filePath) {
  const base = path.basename(filePath);
  const m = base.match(/Week[_\s-]*(\d+)/i);
  if (!m) return null;
  const weekNum = String(m[1]).padStart(2, '0');
  const year = new Date().getFullYear();
  return `${year}-W${weekNum}`;
}

function inferWeekFromSummarySheet(wb) {
  const sheet = wb.Sheets.Summary;
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const title = String((rows[0] && rows[0][0]) || '');
  const m = title.match(/WEEK\s+(\d+)/i);
  if (!m) return null;
  return `${new Date().getFullYear()}-W${String(m[1]).padStart(2, '0')}`;
}

function pushRow(venues, venue, row) {
  if (!venues[venue]) venues[venue] = [];
  venues[venue].push(row);
}

function ingestPeopleSheet(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.People, { defval: '' });
  const venues = {};
  let skipped = 0;
  let skippedNonFood = 0;
  let skippedFoh = 0;
  let skippedUnknownLoc = 0;

  for (const r of rows) {
    const loc = String(r.Location || '').trim();
    const venue = LOCATION_TO_VENUE[loc] || LOCATION_TO_VENUE[loc.toUpperCase()];
    if (!venue) {
      if (loc) skippedUnknownLoc++;
      else skipped++;
      continue;
    }

    const side = String(r['FOH / BOH'] || r.FOH_BOH || '').trim().toUpperCase();
    if (side && side !== 'BOH') {
      skippedFoh++;
      continue;
    }

    const name = String(r.Name || '').trim();
    const position = String(r.Position || '').trim();
    const matrix = normalizeFoodFamily(position);
    if (!name || !matrix) {
      if (name && position) skippedNonFood++;
      else skipped++;
      continue;
    }

    pushRow(venues, venue, {
      name,
      position,
      jobTitle: position,
      matrix,
      matrixRaw: position,
      fileNumber: '',
      companyCode: loc,
      location: loc,
      source: 'viktor_people',
    });
  }

  return { venues, skipped, skippedNonFood, skippedFoh, skippedUnknownLoc, format: 'viktor_people' };
}

function ingestLegacyOverall(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Data - Overall'], { defval: '' });
  const venues = {};
  let skipped = 0;
  let skippedNonFood = 0;

  for (const r of rows) {
    const code = String(r['Payroll Company Code'] || '').trim();
    const venue = CODE_TO_VENUE[code];
    if (!venue) continue;

    const status = String(r['Position Status'] || '').trim().toLowerCase();
    if (status && status !== 'active') {
      skipped++;
      continue;
    }

    const name = String(r['Payroll Name'] || '').trim();
    const matrix = normalizeFoodFamily(r.Matrix);
    if (!name || !matrix) {
      if (name && String(r.Matrix || '').trim()) skippedNonFood++;
      else skipped++;
      continue;
    }

    pushRow(venues, venue, {
      name,
      position: String(r.Position || r['Job Function Description'] || '').trim(),
      jobTitle: String(r['Job Title Description'] || '').trim(),
      matrix,
      matrixRaw: String(r.Matrix || '').trim(),
      fileNumber: String(r['File Number'] || '').trim(),
      companyCode: code,
      source: 'adp_overall',
    });
  }

  return { venues, skipped, skippedNonFood, skippedFoh: 0, skippedUnknownLoc: 0, format: 'adp_overall' };
}

function main() {
  const argPath = process.argv[2];
  const weekArg = process.argv[3];

  let xlsxPath = argPath
    ? (path.isAbsolute(argPath) ? argPath : path.join(ROOT, argPath))
    : path.join(FTE_DIR, 'RDG_FTE_Week_34_summary.xlsx');

  if (!fs.existsSync(xlsxPath)) {
    const alt = path.join(
      process.env.USERPROFILE || '',
      'Downloads',
      path.basename(xlsxPath)
    );
    if (fs.existsSync(alt)) xlsxPath = alt;
  }
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`FTE workbook not found: ${xlsxPath}`);
  }

  const wb = XLSX.readFile(xlsxPath);
  const weekLabel =
    weekArg || inferWeekFromFilename(xlsxPath) || inferWeekFromSummarySheet(wb);
  if (!weekLabel) throw new Error('Could not infer week label; pass e.g. 2026-W34');

  let parsed;
  if (wb.SheetNames.includes('People')) {
    parsed = ingestPeopleSheet(wb);
  } else if (wb.SheetNames.includes('Data - Overall')) {
    parsed = ingestLegacyOverall(wb);
  } else {
    throw new Error(
      'Expected sheet "People" (Viktor) or "Data - Overall" (legacy). Sheets: ' +
        wb.SheetNames.join(', ')
    );
  }

  const { venues, skipped, skippedNonFood, skippedFoh, skippedUnknownLoc, format } = parsed;

  for (const v of Object.keys(venues)) {
    venues[v].sort((a, b) => a.name.localeCompare(b.name) || a.matrix.localeCompare(b.matrix));
  }

  fs.mkdirSync(FTE_DIR, { recursive: true });
  const outPath = path.join(FTE_DIR, `fte-roster-${weekLabel}.json`);
  const payload = {
    week: weekLabel,
    sourceFile: path.basename(xlsxPath),
    sourceFormat: format,
    ingestedAt: new Date().toISOString(),
    companyCodes: CODE_TO_VENUE,
    locations: LOCATION_TO_VENUE,
    foodOnly: true,
    skipped,
    skippedNonFood,
    skippedFoh,
    skippedUnknownLoc,
    venues,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  console.log(`Wrote ${outPath} (format=${format})`);
  console.log(
    `Skipped: non-food=${skippedNonFood} foh=${skippedFoh} unknownLoc=${skippedUnknownLoc} other=${skipped}`
  );
  for (const [v, list] of Object.entries(venues)) {
    const byMatrix = {};
    for (const e of list) byMatrix[e.matrix] = (byMatrix[e.matrix] || 0) + 1;
    console.log(`  ${v}: ${list.length} active food roster rows`);
    console.log(
      '   ',
      Object.entries(byMatrix)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k}=${n}`)
        .join(', ')
    );
  }
}

main();
