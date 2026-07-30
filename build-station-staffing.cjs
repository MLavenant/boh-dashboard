/**
 * Join FTE roster × Toast labor × kitchen station volume → staffing block.
 *
 * Usage:
 *   node build-station-staffing.cjs casa_neos 2026-W30
 *
 * Writes staffing into casa_neos-data-{week}.json and data/{week}/staffing-casa_neos.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.BOH_ROOT || __dirname;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MIN_HOURS = 0.25;

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize "Last, First" / "First Last" → comparable token set + sorted key */
function nameKey(raw) {
  let s = String(raw || '').trim();
  if (!s) return { key: '', tokens: [] };
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((x) => x.trim());
    s = `${first || ''} ${last || ''}`.trim();
  }
  const tokens = stripDiacritics(s).split(' ').filter(Boolean);
  const key = [...tokens].sort().join(' ');
  return { key, tokens, display: s };
}

function namesMatch(a, b) {
  if (!a.key || !b.key) return false;
  if (a.key === b.key) return true;
  // Require last-name token overlap + at least one other token, or exact first+last
  const setA = new Set(a.tokens);
  const setB = new Set(b.tokens);
  const overlap = a.tokens.filter((t) => setB.has(t));
  if (overlap.length >= Math.min(2, Math.max(a.tokens.length, b.tokens.length))) return true;
  // "Garcia Alvarez, Henry" vs "Henry Garcia"
  if (a.tokens.length >= 2 && b.tokens.length >= 2) {
    const lastA = a.tokens[a.tokens.length - 1];
    const lastB = b.tokens[b.tokens.length - 1];
    const firstA = a.tokens[0];
    const firstB = b.tokens[0];
    if ((lastA === lastB || setA.has(lastB) || setB.has(lastA)) &&
        (firstA === firstB || setA.has(firstB) || setB.has(firstA))) {
      return true;
    }
  }
  return false;
}

function stationToFamily(stationName, familyMap) {
  const n = stripDiacritics(stationName);
  for (const ign of familyMap.ignore || []) {
    if (n.includes(stripDiacritics(ign))) return null;
  }
  // Prefer longer / more specific matches: score by match string length
  let best = null;
  let bestLen = -1;
  for (const [family, cfg] of Object.entries(familyMap.families || {})) {
    for (const m of cfg.match || []) {
      const mm = stripDiacritics(m);
      if (n.includes(mm) && mm.length > bestLen) {
        best = family;
        bestLen = mm.length;
      }
    }
  }
  return best;
}

function dayItemCounts(stationDetails, familyMap) {
  /** family -> day -> count */
  const out = {};
  for (const [stName, det] of Object.entries(stationDetails || {})) {
    const family = stationToFamily(stName, familyMap);
    if (!family) continue;
    if (!out[family]) out[family] = {};
    for (const day of DAYS) {
      const hrs = (det.byDayHour || {})[day] || {};
      let sum = 0;
      for (const cell of Object.values(hrs)) sum += cell.count || 0;
      out[family][day] = (out[family][day] || 0) + sum;
    }
  }
  return out;
}

function main() {
  const venue = process.argv[2] || 'casa_neos';
  const weekLabel = process.argv[3] || '2026-W30';

  const rosterPath = path.join(ROOT, 'data', 'fte', `fte-roster-${weekLabel}.json`);
  const laborPath = path.join(ROOT, 'data', weekLabel, `labor-${venue}.json`);
  const mapPath = path.join(ROOT, `station-family-map-${venue}.json`);
  const venueDataPath = path.join(ROOT, `${venue}-data-${weekLabel}.json`);

  for (const p of [rosterPath, laborPath, mapPath, venueDataPath]) {
    if (!fs.existsSync(p)) throw new Error(`Missing ${p}`);
  }

  const rosterFile = loadJson(rosterPath);
  const laborFile = loadJson(laborPath);
  const familyMap = loadJson(mapPath);
  const venueData = loadJson(venueDataPath);

  const roster = (rosterFile.venues && rosterFile.venues[venue]) || [];
  if (!roster.length) throw new Error(`No FTE roster rows for ${venue} in ${rosterPath}`);

  const rosterByKey = roster.map((r) => ({
    ...r,
    ...nameKey(r.name),
  }));

  // Aggregate labor by employee+day (sum hours across jobs)
  const laborByEmpDay = new Map(); // empGuid|date -> { ... }
  for (const e of laborFile.entries || []) {
    if ((e.hours || 0) < MIN_HOURS) continue;
    const id = e.employeeGuid || e.employeeName || e.payrollName;
    const k = `${id}|${e.date}`;
    if (!laborByEmpDay.has(k)) {
      laborByEmpDay.set(k, {
        date: e.date,
        day: e.day,
        employeeGuid: e.employeeGuid,
        employeeName: e.employeeName,
        payrollName: e.payrollName,
        hours: 0,
        jobs: new Set(),
      });
    }
    const row = laborByEmpDay.get(k);
    row.hours += e.hours || 0;
    if (e.jobName) row.jobs.add(e.jobName);
    if (!row.employeeName && e.employeeName) row.employeeName = e.employeeName;
    if (!row.payrollName && e.payrollName) row.payrollName = e.payrollName;
  }

  const matched = [];
  const unmatchedLabor = [];
  const usedRoster = new Set();

  for (const shift of laborByEmpDay.values()) {
    const nk = nameKey(shift.payrollName || shift.employeeName);
    let best = null;
    for (let i = 0; i < rosterByKey.length; i++) {
      if (namesMatch(nk, rosterByKey[i])) {
        best = rosterByKey[i];
        usedRoster.add(i);
        break;
      }
    }
    if (!best) {
      unmatchedLabor.push({
        date: shift.date,
        day: shift.day,
        employeeName: shift.employeeName,
        payrollName: shift.payrollName,
        hours: +shift.hours.toFixed(2),
        jobs: [...shift.jobs],
      });
      continue;
    }
    matched.push({
      date: shift.date,
      day: shift.day,
      employeeName: shift.employeeName || best.name,
      rosterName: best.name,
      matrix: best.matrix,
      position: best.position,
      hours: +shift.hours.toFixed(2),
      jobs: [...shift.jobs],
    });
  }

  const itemCounts = dayItemCounts(venueData.stationDetails, familyMap);

  // Build byFamily
  const byFamily = {};
  const ensureFamily = (f) => {
    if (!byFamily[f]) {
      byFamily[f] = {
        family: f,
        rosterCount: roster.filter((r) => r.matrix === f).length,
        days: {},
      };
      for (const day of DAYS) {
        byFamily[f].days[day] = {
          heads: 0,
          hours: 0,
          names: [],
          itemCount: itemCounts[f]?.[day] || 0,
          itemsPerHead: null,
        };
      }
    }
    return byFamily[f];
  };

  // Pre-create families present in roster or item map
  for (const r of roster) ensureFamily(r.matrix);
  for (const f of Object.keys(itemCounts)) ensureFamily(f);

  for (const m of matched) {
    const fam = ensureFamily(m.matrix);
    const cell = fam.days[m.day];
    if (!cell) continue;
    // Deduplicate same person same day
    if (cell.names.some((n) => n.name === m.rosterName || n.name === m.employeeName)) {
      const existing = cell.names.find((n) => n.name === m.rosterName || n.name === m.employeeName);
      existing.hours = +((existing.hours || 0) + m.hours).toFixed(2);
      cell.hours = +cell.names.reduce((s, n) => s + (n.hours || 0), 0).toFixed(2);
      continue;
    }
    cell.names.push({
      name: m.rosterName,
      toastName: m.employeeName,
      hours: m.hours,
      position: m.position,
      jobs: m.jobs,
    });
    cell.heads = cell.names.length;
    cell.hours = +cell.names.reduce((s, n) => s + (n.hours || 0), 0).toFixed(2);
  }

  for (const fam of Object.values(byFamily)) {
    for (const day of DAYS) {
      const cell = fam.days[day];
      cell.itemCount = itemCounts[fam.family]?.[day] || 0;
      cell.itemsPerHead = cell.heads > 0 ? +(cell.itemCount / cell.heads).toFixed(1) : null;
      cell.names.sort((a, b) => a.name.localeCompare(b.name));
    }
    fam.weekHeadsUnique = new Set(
      DAYS.flatMap((d) => (fam.days[d].names || []).map((n) => n.name))
    ).size;
    fam.weekHours = +DAYS.reduce((s, d) => s + (fam.days[d].hours || 0), 0).toFixed(2);
    fam.weekItemCount = DAYS.reduce((s, d) => s + (fam.days[d].itemCount || 0), 0);
    fam.weekItemsPerHeadDay = (() => {
      const headDays = DAYS.reduce((s, d) => s + (fam.days[d].heads || 0), 0);
      return headDays > 0 ? +(fam.weekItemCount / headDays).toFixed(1) : null;
    })();
  }

  // Toast station → family lookup for UI
  const toastStationFamily = {};
  for (const st of venueData.stations || []) {
    const f = stationToFamily(st.station, familyMap);
    if (f) toastStationFamily[st.station] = f;
  }

  const unmatchedRoster = rosterByKey
    .filter((_, i) => !usedRoster.has(i))
    .map((r) => ({ name: r.name, matrix: r.matrix, position: r.position }));

  const staffing = {
    venue,
    weekLabel,
    builtAt: new Date().toISOString(),
    source: {
      roster: path.basename(rosterPath),
      labor: path.basename(laborPath),
      familyMap: path.basename(mapPath),
    },
    matchStats: {
      laborShiftsMatched: matched.length,
      laborShiftsUnmatched: unmatchedLabor.length,
      rosterUnused: unmatchedRoster.length,
      rosterTotal: roster.length,
    },
    toastStationFamily,
    byFamily,
    unmatchedLabor: unmatchedLabor.slice(0, 80),
    unmatchedRoster: unmatchedRoster.slice(0, 80),
  };

  // The venue JSON is published on a public GitHub Pages site. Embed only
  // aggregate staffing metrics; keep names and QC rows in the local raw output.
  const publicByFamily = {};
  for (const [family, data] of Object.entries(byFamily)) {
    publicByFamily[family] = {
      family: data.family,
      rosterCount: data.rosterCount,
      weekHeadsUnique: data.weekHeadsUnique,
      weekHours: data.weekHours,
      weekItemCount: data.weekItemCount,
      weekItemsPerHeadDay: data.weekItemsPerHeadDay,
      days: {},
    };
    for (const day of DAYS) {
      const cell = data.days[day];
      publicByFamily[family].days[day] = {
        heads: cell.heads,
        hours: cell.hours,
        itemCount: cell.itemCount,
        itemsPerHead: cell.itemsPerHead,
      };
    }
  }

  venueData.staffing = {
    venue,
    weekLabel,
    builtAt: staffing.builtAt,
    matchStats: staffing.matchStats,
    toastStationFamily,
    byFamily: publicByFamily,
  };
  fs.writeFileSync(venueDataPath, JSON.stringify(venueData, null, 2));

  const outDir = path.join(ROOT, 'data', weekLabel);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `staffing-${venue}.json`);
  fs.writeFileSync(outPath, JSON.stringify(staffing, null, 2));

  console.log(`Wrote ${outPath}`);
  console.log(`Updated ${venueDataPath}`);
  console.log('Match stats:', staffing.matchStats);
  const saute = byFamily.Saute;
  if (saute) {
    console.log('Saute by day:');
    for (const day of DAYS) {
      const c = saute.days[day];
      console.log(
        `  ${day.slice(0, 3)}: heads=${c.heads} hours=${c.hours} items=${c.itemCount} items/head=${c.itemsPerHead ?? '—'}`
      );
    }
  }
}

main();
