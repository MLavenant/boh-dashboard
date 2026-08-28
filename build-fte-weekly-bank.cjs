/**
 * Build weekly FTE bank files for fiscal W01→W34 from a Viktor export.
 *
 * Uses People + New hires + Terminations (merged in fte-bank-{asOf}.json):
 *   - Person is ON a week if hireDate ≤ weekEnd AND (no term OR termDate ≥ weekStart)
 *   - fte-roster-{week}.json  → food-production BOH (staffing join)
 *   - fte-staff-{week}.json   → full FOH+BOH staff (CDP / station history)
 *
 * Limitation: a single Week-N export only contains current People + that week's
 * terminations. Staff who left in earlier weeks are not reconstructable until
 * weekly exports are archived. Survivors (still active / term'd this week) are
 * placed correctly back to their hire date.
 *
 * Usage:
 *   node build-fte-weekly-bank.cjs
 *   node build-fte-weekly-bank.cjs --from 2026-W01 --to 2026-W34
 *   node build-fte-weekly-bank.cjs --xlsx data/fte/RDG_FTE_Week_34_summary.xlsx
 *   node build-fte-weekly-bank.cjs --fetch   # re-download Viktor first
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const XLSX = require('xlsx');
const {
  CODE_TO_VENUE,
  LOCATION_TO_VENUE,
  listIsoWeeks,
  STAFFING_VENUES,
} = require('./boh-staffing-shared.cjs');
const {
  buildPersonBank,
  foodRosterFromBank,
  fullStaffFromBank,
} = require('./ingest-fte-roster.cjs');

const ROOT = process.env.BOH_ROOT || __dirname;
const FTE_DIR = path.join(ROOT, 'data', 'fte');

function parseArgs(argv) {
  const out = {
    from: '2026-W01',
    to: '2026-W34',
    xlsx: null,
    fetch: false,
    asOf: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.from = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (a === '--xlsx') out.xlsx = argv[++i];
    else if (a === '--as-of') out.asOf = argv[++i];
    else if (a === '--fetch') out.fetch = true;
  }
  return out;
}

function findLatestSummary() {
  if (!fs.existsSync(FTE_DIR)) return null;
  const files = fs
    .readdirSync(FTE_DIR)
    .filter((f) => /^RDG_FTE_Week_\d+_summary\.xlsx$/i.test(f))
    .sort();
  return files.length ? path.join(FTE_DIR, files[files.length - 1]) : null;
}

function inferAsOfFromXlsx(xlsxPath, wb) {
  const base = path.basename(xlsxPath);
  const m = base.match(/Week[_\s-]*(\d+)/i);
  if (m) return `${new Date().getFullYear()}-W${String(m[1]).padStart(2, '0')}`;
  if (wb.Sheets.Summary) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Summary, { header: 1, defval: '' });
    const title = String((rows[0] && rows[0][0]) || '');
    const wm = title.match(/WEEK\s+(\d+)/i);
    if (wm) return `${new Date().getFullYear()}-W${String(wm[1]).padStart(2, '0')}`;
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(FTE_DIR, { recursive: true });

  if (args.fetch) {
    const week = args.asOf || args.to;
    console.log(`Fetching Viktor FTE for ${week}…`);
    const r = spawnSync(process.execPath, ['fetch-viktor-fte-week.mjs', week], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, VIKTOR_FTE_HEADLESS: process.env.VIKTOR_FTE_HEADLESS || '1' },
    });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) throw new Error('Viktor fetch failed');
  }

  let xlsxPath = args.xlsx
    ? path.isAbsolute(args.xlsx)
      ? args.xlsx
      : path.join(ROOT, args.xlsx)
    : findLatestSummary();
  if (!xlsxPath || !fs.existsSync(xlsxPath)) {
    throw new Error('No Viktor summary xlsx found — run with --fetch or --xlsx path');
  }

  console.log(`Source workbook: ${xlsxPath}`);
  const wb = XLSX.readFile(xlsxPath);
  const asOf = args.asOf || inferAsOfFromXlsx(xlsxPath, wb);
  if (!asOf) throw new Error('Could not infer as-of week; pass --as-of 2026-W34');

  const bank = buildPersonBank(wb);
  const bankPath = path.join(FTE_DIR, `fte-bank-${asOf}.json`);
  fs.writeFileSync(
    bankPath,
    JSON.stringify(
      {
        week: asOf,
        asOfWeek: asOf,
        sourceFile: path.basename(xlsxPath),
        sourceFormat: 'viktor_people_hires_terms',
        sheets: wb.SheetNames,
        ingestedAt: new Date().toISOString(),
        sheetCounts: bank.sheetCounts,
        locations: LOCATION_TO_VENUE,
        people: bank.people,
        note:
          'Weekly reconstruction uses hireDate/terminationDate. Historical leavers ' +
          'before this export week are not in People/Terminations — archive weekly exports going forward.',
      },
      null,
      2
    )
  );
  console.log(
    `Bank: ${bankPath} · merged ${bank.sheetCounts.merged} (People ${bank.sheetCounts.people}, hires ${bank.sheetCounts.newHires}, terms ${bank.sheetCounts.terminations})`
  );

  const weeks = listIsoWeeks(args.from, args.to);
  const summary = {
    asOfWeek: asOf,
    from: args.from,
    to: args.to,
    sourceFile: path.basename(xlsxPath),
    bankFile: path.basename(bankPath),
    builtAt: new Date().toISOString(),
    weeks: {},
  };

  for (const { weekKey, startDate, endDate } of weeks) {
    const food = foodRosterFromBank(bank.people, { weekStart: startDate, weekEnd: endDate });
    // Staffing join venues only in fte-roster (drop lounge/commissary/claudie from food roster
    // if we want parity — but Claudie food cooks should be available for CDP; keep all with matrix)
    const rosterVenues = {};
    for (const [v, list] of Object.entries(food.venues)) {
      // Keep Claudie in roster files for CDP; staffing join already filters STAFFING_VENUES
      rosterVenues[v] = list;
    }

    const rosterPath = path.join(FTE_DIR, `fte-roster-${weekKey}.json`);
    fs.writeFileSync(
      rosterPath,
      JSON.stringify(
        {
          week: weekKey,
          weekStart: startDate,
          weekEnd: endDate,
          sourceFile: path.basename(xlsxPath),
          sourceFormat: 'viktor_reconstructed',
          asOfWeek: asOf,
          bankFile: path.basename(bankPath),
          ingestedAt: new Date().toISOString(),
          companyCodes: CODE_TO_VENUE,
          locations: LOCATION_TO_VENUE,
          foodOnly: true,
          reconstruction:
            'active if hireDate<=weekEnd and (no terminationDate or terminationDate>=weekStart)',
          skipped: food.skipped,
          skippedNonFood: food.skippedNonFood,
          skippedFoh: food.skippedFoh,
          skippedUnknownLoc: food.skippedUnknownLoc,
          skippedInactive: food.skippedInactive,
          venues: rosterVenues,
        },
        null,
        2
      )
    );

    const staffVenues = fullStaffFromBank(bank.people, {
      weekStart: startDate,
      weekEnd: endDate,
    });
    const staffPath = path.join(FTE_DIR, `fte-staff-${weekKey}.json`);
    fs.writeFileSync(
      staffPath,
      JSON.stringify(
        {
          week: weekKey,
          weekStart: startDate,
          weekEnd: endDate,
          sourceFile: path.basename(xlsxPath),
          sourceFormat: 'viktor_reconstructed_full',
          asOfWeek: asOf,
          bankFile: path.basename(bankPath),
          ingestedAt: new Date().toISOString(),
          foodOnly: false,
          venues: staffVenues,
        },
        null,
        2
      )
    );

    const foodCount = Object.values(rosterVenues).reduce((n, a) => n + a.length, 0);
    const staffCount = Object.values(staffVenues).reduce((n, a) => n + a.length, 0);
    const byVenueFood = {};
    for (const [v, list] of Object.entries(rosterVenues)) byVenueFood[v] = list.length;
    summary.weeks[weekKey] = {
      startDate,
      endDate,
      foodRoster: foodCount,
      fullStaff: staffCount,
      byVenueFood,
    };
    console.log(
      `${weekKey}: food roster ${foodCount} · full staff ${staffCount} · ${Object.entries(byVenueFood)
        .map(([v, n]) => `${v}=${n}`)
        .join(' ')}`
    );
  }

  const statusPath = path.join(FTE_DIR, 'fte-weekly-bank-status.json');
  fs.writeFileSync(statusPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${weeks.length} weeks → ${FTE_DIR}`);
  console.log(`Status: ${statusPath}`);
  console.log(
    `Staffing venues for join: ${STAFFING_VENUES.join(', ')} (fte-roster-*.json). CDP: use fte-staff-*.json + fte-bank-*.json.`
  );
}

main();
