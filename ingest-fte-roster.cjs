/**
 * Ingest Viktor Ops FTE Excel → full staff bank + food roster JSON.
 *
 * Sheets used (all required for Viktor exports):
 *   People        — current active headcount (Name, Location, FOH/BOH, Position, Hire date)
 *   New hires     — this week's hires (Hire date, optional Termination date)
 *   Terminations  — this week's terms (Hire date, Termination date)
 *
 * Also supports legacy ADP "Data - Overall".
 *
 * Usage:
 *   node ingest-fte-roster.cjs data/fte/RDG_FTE_Week_34_summary.xlsx 2026-W34
 *   node ingest-fte-roster.cjs data/fte/RDG_FTE_Week_34_summary.xlsx 2026-W34 --bank
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const {
  CODE_TO_VENUE,
  LOCATION_TO_VENUE,
  normalizeFoodFamily,
  nameKey,
} = require('./boh-staffing-shared.cjs');

const ROOT = process.env.BOH_ROOT || __dirname;
const FTE_DIR = path.join(ROOT, 'data', 'fte');

const PEOPLE_SHEET = 'People';
const HIRES_SHEET = 'New hires';
const TERMS_SHEET = 'Terminations';

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

/** Parse M/D/YYYY or Excel serial → YYYY-MM-DD */
function parseViktorDate(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = XLSX.SSF.parse_date_code(raw);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function resolveVenue(loc) {
  const raw = String(loc || '').trim();
  return LOCATION_TO_VENUE[raw] || LOCATION_TO_VENUE[raw.toUpperCase()] || null;
}

function personKey(name, location) {
  const nk = nameKey(name);
  return `${nk.key}||${String(location || '').trim().toUpperCase()}`;
}

function sheetRows(wb, name) {
  if (!wb.Sheets[name]) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
}

function rowToPerson(r, source) {
  const name = String(r.Name || '').trim();
  const location = String(r.Location || '').trim();
  const side = String(r['FOH / BOH'] || r.FOH_BOH || '').trim().toUpperCase();
  const position = String(r.Position || '').trim();
  const hireDate = parseViktorDate(r['Hire date'] || r.HireDate || r['Hire Date']);
  const terminationDate = parseViktorDate(
    r['Termination date'] || r.TerminationDate || r['Termination Date']
  );
  const venue = resolveVenue(location);
  const matrix = normalizeFoodFamily(position);
  return {
    name,
    location,
    venue,
    side: side || null,
    position,
    matrix,
    matrixRaw: position,
    hireDate,
    terminationDate,
    newThisWeek: String(r['New this week'] || '').trim().toLowerCase() === 'yes',
    tenureYears: r['Tenure (yrs)'] === '' || r['Tenure (yrs)'] == null ? null : Number(r['Tenure (yrs)']),
    source,
    key: personKey(name, location),
  };
}

/**
 * Merge People + New hires + Terminations into one person map.
 * Terminations overwrite/enrich People (adds terminationDate).
 * New hires fill gaps if someone isn't on People yet.
 */
function buildPersonBank(wb) {
  const people = sheetRows(wb, PEOPLE_SHEET).map((r) => rowToPerson(r, 'viktor_people'));
  const hires = sheetRows(wb, HIRES_SHEET).map((r) => rowToPerson(r, 'viktor_new_hire'));
  const terms = sheetRows(wb, TERMS_SHEET).map((r) => rowToPerson(r, 'viktor_termination'));

  const byKey = new Map();

  function upsert(p, preferTerm = false) {
    if (!p.name) return;
    const prev = byKey.get(p.key);
    if (!prev) {
      byKey.set(p.key, { ...p });
      return;
    }
    const merged = { ...prev };
    // Prefer non-empty fields; terminations win for terminationDate
    for (const k of Object.keys(p)) {
      if (p[k] == null || p[k] === '') continue;
      if (k === 'terminationDate' || preferTerm) merged[k] = p[k];
      else if (merged[k] == null || merged[k] === '') merged[k] = p[k];
    }
    // Track all sources seen
    const sources = new Set([prev.source, p.source].filter(Boolean));
    if (prev.sources) prev.sources.forEach((s) => sources.add(s));
    merged.sources = [...sources];
    if (preferTerm || p.source === 'viktor_termination') {
      merged.source = 'viktor_termination';
      merged.status = 'terminated';
    }
    byKey.set(p.key, merged);
  }

  for (const p of people) {
    p.status = 'active';
    upsert(p);
  }
  for (const p of hires) {
    p.status = p.terminationDate ? 'terminated' : 'active';
    upsert(p);
  }
  for (const p of terms) {
    p.status = 'terminated';
    upsert(p, true);
  }

  const all = [...byKey.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.location.localeCompare(b.location)
  );

  return {
    people: all,
    sheetCounts: {
      people: people.length,
      newHires: hires.length,
      terminations: terms.length,
      merged: all.length,
    },
    raw: {
      people,
      newHires: hires,
      terminations: terms,
    },
  };
}

function pushRow(venues, venue, row) {
  if (!venues[venue]) venues[venue] = [];
  venues[venue].push(row);
}

/** Food-production BOH roster rows for staffing join (existing shape). */
function foodRosterFromBank(people, { weekStart, weekEnd } = {}) {
  const venues = {};
  let skipped = 0;
  let skippedNonFood = 0;
  let skippedFoh = 0;
  let skippedUnknownLoc = 0;
  let skippedInactive = 0;

  for (const p of people) {
    if (!p.venue) {
      if (p.location) skippedUnknownLoc++;
      else skipped++;
      continue;
    }
    // Kitchen staffing venues only (not lounge/commissary) — Claudie included in bank staff file
    if (p.side && p.side !== 'BOH') {
      skippedFoh++;
      continue;
    }
    if (!p.matrix) {
      if (p.position) skippedNonFood++;
      else skipped++;
      continue;
    }
    if (weekStart && weekEnd) {
      if (p.hireDate && p.hireDate > weekEnd) {
        skippedInactive++;
        continue;
      }
      // Terminated before the week starts → not on this week's roster
      if (p.terminationDate && p.terminationDate < weekStart) {
        skippedInactive++;
        continue;
      }
    }

    pushRow(venues, p.venue, {
      name: p.name,
      position: p.position,
      jobTitle: p.position,
      matrix: p.matrix,
      matrixRaw: p.position,
      fileNumber: '',
      companyCode: p.location,
      location: p.location,
      hireDate: p.hireDate,
      terminationDate: p.terminationDate || null,
      status: p.status || 'active',
      source: p.source,
    });
  }

  for (const v of Object.keys(venues)) {
    venues[v].sort((a, b) => a.name.localeCompare(b.name) || a.matrix.localeCompare(b.matrix));
  }

  return { venues, skipped, skippedNonFood, skippedFoh, skippedUnknownLoc, skippedInactive };
}

/** Full staff (FOH+BOH, all positions) for CDP / station history. */
function fullStaffFromBank(people, { weekStart, weekEnd } = {}) {
  const venues = {};
  for (const p of people) {
    if (!p.venue) continue;
    if (weekStart && weekEnd) {
      if (p.hireDate && p.hireDate > weekEnd) continue;
      if (p.terminationDate && p.terminationDate < weekStart) continue;
    }
    pushRow(venues, p.venue, {
      name: p.name,
      location: p.location,
      side: p.side,
      position: p.position,
      matrix: p.matrix,
      hireDate: p.hireDate,
      terminationDate: p.terminationDate || null,
      status: p.terminationDate && weekEnd && p.terminationDate <= weekEnd ? 'terminated' : 'active',
      source: p.source,
    });
  }
  for (const v of Object.keys(venues)) {
    venues[v].sort((a, b) => a.name.localeCompare(b.name) || String(a.position).localeCompare(b.position));
  }
  return venues;
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

  return {
    venues,
    skipped,
    skippedNonFood,
    skippedFoh: 0,
    skippedUnknownLoc: 0,
    skippedInactive: 0,
    format: 'adp_overall',
  };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
  const argPath = args[0];
  const weekArg = args[1];

  let xlsxPath = argPath
    ? path.isAbsolute(argPath)
      ? argPath
      : path.join(ROOT, argPath)
    : path.join(FTE_DIR, 'RDG_FTE_Week_34_summary.xlsx');

  if (!fs.existsSync(xlsxPath)) {
    const alt = path.join(process.env.USERPROFILE || '', 'Downloads', path.basename(xlsxPath));
    if (fs.existsSync(alt)) xlsxPath = alt;
  }
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`FTE workbook not found: ${xlsxPath}`);
  }

  const wb = XLSX.readFile(xlsxPath);
  const weekLabel =
    weekArg || inferWeekFromFilename(xlsxPath) || inferWeekFromSummarySheet(wb);
  if (!weekLabel) throw new Error('Could not infer week label; pass e.g. 2026-W34');

  fs.mkdirSync(FTE_DIR, { recursive: true });

  if (wb.SheetNames.includes(PEOPLE_SHEET)) {
    const missing = [HIRES_SHEET, TERMS_SHEET].filter((s) => !wb.SheetNames.includes(s));
    if (missing.length) {
      console.warn(`WARN: Viktor sheets missing (${missing.join(', ')}); People-only ingest.`);
    }

    const bank = buildPersonBank(wb);
    const food = foodRosterFromBank(bank.people);
    const staffVenues = fullStaffFromBank(bank.people);

    const bankPath = path.join(FTE_DIR, `fte-bank-${weekLabel}.json`);
    const bankPayload = {
      week: weekLabel,
      asOfWeek: weekLabel,
      sourceFile: path.basename(xlsxPath),
      sourceFormat: 'viktor_people_hires_terms',
      sheets: wb.SheetNames,
      ingestedAt: new Date().toISOString(),
      sheetCounts: bank.sheetCounts,
      locations: LOCATION_TO_VENUE,
      /** Merged People ∪ New hires ∪ Terminations — full FOH+BOH staff bank */
      people: bank.people,
      raw: flags.has('--keep-raw') ? bank.raw : undefined,
    };
    fs.writeFileSync(bankPath, JSON.stringify(bankPayload, null, 2));
    console.log(
      `Wrote ${bankPath} (merged=${bank.sheetCounts.merged} people=${bank.sheetCounts.people} hires=${bank.sheetCounts.newHires} terms=${bank.sheetCounts.terminations})`
    );

    const staffPath = path.join(FTE_DIR, `fte-staff-${weekLabel}.json`);
    fs.writeFileSync(
      staffPath,
      JSON.stringify(
        {
          week: weekLabel,
          sourceFile: path.basename(xlsxPath),
          sourceFormat: 'viktor_full_staff',
          ingestedAt: new Date().toISOString(),
          foodOnly: false,
          venues: staffVenues,
        },
        null,
        2
      )
    );
    console.log(`Wrote ${staffPath} (all FOH+BOH positions)`);

    const outPath = path.join(FTE_DIR, `fte-roster-${weekLabel}.json`);
    const payload = {
      week: weekLabel,
      sourceFile: path.basename(xlsxPath),
      sourceFormat: 'viktor_people_hires_terms',
      ingestedAt: new Date().toISOString(),
      companyCodes: CODE_TO_VENUE,
      locations: LOCATION_TO_VENUE,
      foodOnly: true,
      bankFile: path.basename(bankPath),
      skipped: food.skipped,
      skippedNonFood: food.skippedNonFood,
      skippedFoh: food.skippedFoh,
      skippedUnknownLoc: food.skippedUnknownLoc,
      venues: food.venues,
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`Wrote ${outPath} (format=viktor_people_hires_terms, food BOH)`);
    console.log(
      `Skipped: non-food=${food.skippedNonFood} foh=${food.skippedFoh} unknownLoc=${food.skippedUnknownLoc} other=${food.skipped}`
    );
    for (const [v, list] of Object.entries(food.venues)) {
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

    if (flags.has('--bank')) {
      // Defer weekly reconstruction to build-fte-weekly-bank.cjs
      console.log('Tip: run node build-fte-weekly-bank.cjs to materialize W01–W34 from this bank.');
    }
    return;
  }

  if (wb.SheetNames.includes('Data - Overall')) {
    const parsed = ingestLegacyOverall(wb);
    const { venues, skipped, skippedNonFood, skippedFoh, skippedUnknownLoc, format } = parsed;
    for (const v of Object.keys(venues)) {
      venues[v].sort((a, b) => a.name.localeCompare(b.name) || a.matrix.localeCompare(b.matrix));
    }
    const outPath = path.join(FTE_DIR, `fte-roster-${weekLabel}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
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
        },
        null,
        2
      )
    );
    console.log(`Wrote ${outPath} (format=${format})`);
    return;
  }

  throw new Error(
    'Expected sheet "People" (Viktor) or "Data - Overall" (legacy). Sheets: ' +
      wb.SheetNames.join(', ')
  );
}

module.exports = {
  buildPersonBank,
  foodRosterFromBank,
  fullStaffFromBank,
  parseViktorDate,
  PEOPLE_SHEET,
  HIRES_SHEET,
  TERMS_SHEET,
};

if (require.main === module) {
  main();
}
