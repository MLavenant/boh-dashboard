/**
 * Ingest ADP/FTE workbook → weekly roster JSON (food-production families only).
 *
 * Usage:
 *   node ingest-fte-roster.cjs [path-to.xlsx] [weekLabel]
 *   node ingest-fte-roster.cjs data/fte/RDG_FTE_Week_30.xlsx 2026-W30
 *
 * Reads sheet "Data - Overall". Maps payroll company codes → venue keys.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { CODE_TO_VENUE, normalizeFoodFamily } = require('./boh-staffing-shared.cjs');

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

function main() {
  const argPath = process.argv[2];
  const weekArg = process.argv[3];

  let xlsxPath = argPath
    ? (path.isAbsolute(argPath) ? argPath : path.join(ROOT, argPath))
    : path.join(FTE_DIR, 'RDG_FTE_Week_30.xlsx');

  if (!fs.existsSync(xlsxPath)) {
    // Tolerate trailing-space filenames from Downloads
    const alt = path.join(
      process.env.USERPROFILE || '',
      'Downloads',
      'RDG_FTE_Week_30 .xlsx'
    );
    if (fs.existsSync(alt)) xlsxPath = alt;
  }
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`FTE workbook not found: ${xlsxPath}`);
  }

  const weekLabel = weekArg || inferWeekFromFilename(xlsxPath);
  if (!weekLabel) throw new Error('Could not infer week label; pass e.g. 2026-W30');

  const wb = XLSX.readFile(xlsxPath);
  if (!wb.SheetNames.includes('Data - Overall')) {
    throw new Error('Sheet "Data - Overall" not found. Sheets: ' + wb.SheetNames.join(', '));
  }

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

    if (!venues[venue]) venues[venue] = [];
    venues[venue].push({
      name,
      position: String(r.Position || r['Job Function Description'] || '').trim(),
      jobTitle: String(r['Job Title Description'] || '').trim(),
      matrix,
      matrixRaw: String(r.Matrix || '').trim(),
      fileNumber: String(r['File Number'] || '').trim(),
      companyCode: code,
    });
  }

  for (const v of Object.keys(venues)) {
    venues[v].sort((a, b) => a.name.localeCompare(b.name) || a.matrix.localeCompare(b.matrix));
  }

  fs.mkdirSync(FTE_DIR, { recursive: true });
  const outPath = path.join(FTE_DIR, `fte-roster-${weekLabel}.json`);
  const payload = {
    week: weekLabel,
    sourceFile: path.basename(xlsxPath),
    ingestedAt: new Date().toISOString(),
    companyCodes: CODE_TO_VENUE,
    foodOnly: true,
    skipped,
    skippedNonFood,
    venues,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  console.log(`Wrote ${outPath}`);
  console.log(`Skipped non-food Matrix rows: ${skippedNonFood}`);
  for (const [v, list] of Object.entries(venues)) {
    const byMatrix = {};
    for (const e of list) byMatrix[e.matrix] = (byMatrix[e.matrix] || 0) + 1;
    console.log(`  ${v}: ${list.length} active food roster rows`);
    console.log('   ', Object.entries(byMatrix).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(', '));
  }
}

main();
