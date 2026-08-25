/**
 * Weekly BOH staffing orchestrator (food stations, non-Claudie venues).
 *
 * Usage:
 *   node weekly-staffing.cjs [weekLabel] [path-to-fte.xlsx]
 *
 * Steps: ingest FTE → fetch labor (--all) → rebuild venue day volume fields if needed
 *         → join staffing for each venue.
 * Missing FTE workbook → warn and exit 0 (do not corrupt prior staffing).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { STAFFING_VENUES } = require('./boh-staffing-shared.cjs');

const ROOT = process.env.BOH_ROOT || __dirname;

function log(msg) {
  console.log(`[weekly-staffing] ${msg}`);
}

function run(args, { optional = false } = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    const msg = `${args.join(' ')} exited ${r.status}`;
    if (optional) {
      log(`WARN: ${msg}`);
      return false;
    }
    throw new Error(msg);
  }
  return true;
}

function inferLatestWeek() {
  const dataRoot = path.join(ROOT, 'data');
  if (!fs.existsSync(dataRoot)) return null;
  const weeks = fs.readdirSync(dataRoot)
    .filter((d) => /^\d{4}-W\d{2}$/.test(d))
    .sort();
  return weeks.length ? weeks[weeks.length - 1] : null;
}

function findFteWorkbook(weekLabel, explicitPath) {
  if (explicitPath) {
    const p = path.isAbsolute(explicitPath) ? explicitPath : path.join(ROOT, explicitPath);
    if (fs.existsSync(p)) return p;
  }
  const weekNum = (weekLabel.match(/W(\d+)/) || [])[1];
  const n = Number(weekNum);
  const downloads = path.join(process.env.USERPROFILE || '', 'Downloads');
  // Prefer Viktor Ops FTE export (People tab) over legacy ADP "Data - Overall"
  const candidates = [
    path.join(ROOT, 'data', 'fte', `RDG_FTE_Week_${weekNum}_summary.xlsx`),
    path.join(ROOT, 'data', 'fte', `RDG_FTE_Week_${n}_summary.xlsx`),
    path.join(downloads, `RDG_FTE_Week_${weekNum}_summary.xlsx`),
    path.join(downloads, `RDG_FTE_Week_${n}_summary.xlsx`),
    path.join(ROOT, 'data', 'fte', `RDG_FTE_Week_${weekNum}.xlsx`),
    path.join(ROOT, 'data', 'fte', `RDG_FTE_Week_${n}.xlsx`),
    path.join(ROOT, 'data', 'fte', `RDG_FTE_Week_${weekNum} .xlsx`),
    path.join(downloads, `RDG_FTE_Week_${weekNum}.xlsx`),
    path.join(downloads, `RDG_FTE_Week_${weekNum} .xlsx`),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function main() {
  const weekLabel = process.argv[2] || inferLatestWeek() || '2026-W30';
  const xlsxArg = process.argv[3];
  const xlsx = findFteWorkbook(weekLabel, xlsxArg);

  if (!xlsx) {
    log(`WARN: No FTE workbook for ${weekLabel} — skipping staffing refresh (prior data kept).`);
    process.exit(0);
  }

  log(`Week ${weekLabel} · FTE=${xlsx}`);
  run(['ingest-fte-roster.cjs', xlsx, weekLabel]);

  // Refresh guestsSeated / stationDayVolume on venue week JSON when kitchen inputs exist
  for (const venue of STAFFING_VENUES) {
    const kt = path.join(ROOT, 'data', weekLabel, `kitchen-timing-${venue}.json`);
    const weekFile = path.join(ROOT, `${venue}-data-${weekLabel}.json`);
    if (fs.existsSync(kt) && fs.existsSync(weekFile)) {
      run(['process-venue-data.cjs', venue, weekLabel], { optional: true });
    } else {
      log(`WARN: skip process-venue-data for ${venue} (missing kitchen or week JSON)`);
    }
  }

  run(['fetch-labor-week.cjs', '--all', weekLabel]);

  // --all runs a second pass so peer signals see the full same-week panel
  const joinOk = run(['build-station-staffing.cjs', '--all', weekLabel], { optional: true });
  let ok = 0;
  for (const venue of STAFFING_VENUES) {
    if (fs.existsSync(path.join(ROOT, `${venue}-data-${weekLabel}.json`))) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(ROOT, `${venue}-data-${weekLabel}.json`), 'utf8'));
        if (d.staffing && d.staffing.byFamily) ok++;
      } catch (_) { /* ignore */ }
    }
  }
  if (!joinOk) log('WARN: staffing join reported errors');
  log(`Staffing complete for ${ok}/${STAFFING_VENUES.length} venues`);
  if (ok === 0) process.exit(1);
}

main();
