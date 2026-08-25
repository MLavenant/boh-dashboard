/**
 * Private Toast↔FTE match-balance report (local only — contains names).
 *
 * Usage:
 *   node build-staffing-balance.cjs 2026-W34
 *   node build-staffing-balance.cjs 2026-W34 casa_neos
 *
 * Writes:
 *   data/{week}/staffing-balance-{venue}.json
 *   data/{week}/staffing-balance.html
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  STAFFING_VENUES,
  FOOD_FAMILIES,
  normalizeFoodFamily,
  resolveVenueSlug,
} = require('./boh-staffing-shared.cjs');

const ROOT = process.env.BOH_ROOT || __dirname;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FOOD_SET = new Set(FOOD_FAMILIES);

const FOH_JOB_RE =
  /^(server|bartender|busser|host|captain|runner|sommelier|barista|maitre|mître|door person|bathroom|polisher|barback|bar supervisor|lead bartender|lead host|j1\s*-\s*server|j1\s*-\s*busser|j1\s*-\s*runner|menu specialist|reservation|vip host)/i;

const BOH_JOB_RE =
  /cook|cdp|dish|prep|pastry|sushi|line|expo|butcher|robata|saute|fry|garde|raw|crudo|pizza|receiver|chef|tempura|maki|grill|plancha|training\s*-\s*boh|rdgu-boh/i;

const FOOD_STATION_JOB_RE =
  /line cook|cdp|pastry|sushi|robata|saute|fry|garde|prep cook|expo|pizza|tempura|maki|grill|plancha|butcher|crudo|\braw\b|chef|training\s*-\s*boh|temp (line|cdp|pastry|prep)/i;

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function isFohJob(jobName) {
  const j = String(jobName || '').trim();
  if (!j) return false;
  if (FOH_JOB_RE.test(j)) return true;
  if (BOH_JOB_RE.test(j)) return false;
  return !BOH_JOB_RE.test(j);
}

function isBohJob(jobName) {
  return BOH_JOB_RE.test(String(jobName || ''));
}

function isFoodStationJob(jobName) {
  const j = String(jobName || '');
  if (normalizeFoodFamily(j)) return true;
  return FOOD_STATION_JOB_RE.test(j);
}

function jobToFamily(jobName) {
  return normalizeFoodFamily(jobName);
}

function conflictReason(fteFamily, toastJobs) {
  const jobFamilies = [...new Set((toastJobs || []).map(jobToFamily).filter(Boolean))];
  if (!fteFamily || !jobFamilies.length) return null;
  if (jobFamilies.includes(fteFamily)) return null;
  // Generic Line Cook / CDP clocks aren't a hard conflict with a specific FTE station
  const generic = (toastJobs || []).every((j) =>
    /^(line cook|cdp|sr\.?\s*cdp|temp (line|cdp)|training - boh|chef)$/i.test(String(j).trim())
  );
  if (generic) return null;
  return {
    fteFamily,
    toastJobs: [...toastJobs],
    toastFamilies: jobFamilies,
  };
}

function buildVenueBalance(venue, weekLabel) {
  const staffingPath = path.join(ROOT, 'data', weekLabel, `staffing-${venue}.json`);
  const laborPath = path.join(ROOT, 'data', weekLabel, `labor-${venue}.json`);
  const rosterPath = path.join(ROOT, 'data', 'fte', `fte-roster-${weekLabel}.json`);

  if (!fs.existsSync(staffingPath)) throw new Error(`Missing ${staffingPath}`);
  if (!fs.existsSync(laborPath)) throw new Error(`Missing ${laborPath}`);
  if (!fs.existsSync(rosterPath)) throw new Error(`Missing ${rosterPath}`);

  const staffing = loadJson(staffingPath);
  const labor = loadJson(laborPath);
  const rosterFile = loadJson(rosterPath);
  const roster = ((rosterFile.venues && rosterFile.venues[venue]) || []).filter((r) =>
    FOOD_SET.has(normalizeFoodFamily(r.matrix) || r.matrix)
  );

  const matched = [];
  const stationConflicts = [];
  const matchedNames = new Set();

  for (const [family, fam] of Object.entries(staffing.byFamily || {})) {
    for (const day of DAYS) {
      const cell = fam.days && fam.days[day];
      if (!cell || !Array.isArray(cell.names)) continue;
      for (const n of cell.names) {
        matchedNames.add(n.name);
        const row = {
          day,
          fteName: n.name,
          toastName: n.toastName || null,
          fteFamily: family,
          ftePosition: n.position || family,
          hours: n.hours || 0,
          toastJobs: n.jobs || [],
        };
        matched.push(row);
        const conflict = conflictReason(family, n.jobs || []);
        if (conflict) {
          stationConflicts.push({ ...row, ...conflict });
        }
      }
    }
  }

  // Attach raw time punches for matched people (by toast/fte name + day)
  const punchesByKey = new Map();
  for (const e of labor.entries || []) {
    const day = e.day;
    const names = [e.employeeName, e.payrollName].filter(Boolean);
    for (const nm of names) {
      const k = `${day}|${nm.toLowerCase()}`;
      if (!punchesByKey.has(k)) punchesByKey.set(k, []);
      punchesByKey.get(k).push({
        inDate: e.inDate,
        outDate: e.outDate,
        hours: e.hours,
        jobName: e.jobName,
        date: e.date,
      });
    }
  }
  for (const m of matched) {
    const keys = [`${m.day}|${(m.toastName || '').toLowerCase()}`, `${m.day}|${(m.fteName || '').toLowerCase()}`];
    const punches = [];
    for (const k of keys) {
      for (const p of punchesByKey.get(k) || []) punches.push(p);
    }
    m.timeEntries = punches.slice(0, 12);
  }

  const unmatchedLabor = staffing.unmatchedLabor || [];
  const unmatchedBohLabor = [];
  const fohLaborIgnored = [];
  const supportBohLabor = [];
  for (const u of unmatchedLabor) {
    const jobs = u.jobs || [];
    if (jobs.some(isFoodStationJob)) unmatchedBohLabor.push(u);
    else if (jobs.some(isBohJob)) supportBohLabor.push(u);
    else fohLaborIgnored.push(u);
  }

  const unmatchedRoster = (staffing.unmatchedRoster || []).map((r) => ({
    name: r.name,
    matrix: r.matrix,
    position: r.position,
  }));
  // Prefer computing unused from matchedNames for accuracy
  const rosterUnused = roster
    .filter((r) => !matchedNames.has(r.name))
    .map((r) => ({
      name: r.name,
      matrix: normalizeFoodFamily(r.matrix) || r.matrix,
      position: r.position,
    }));

  const matchedBohPersonDays = matched.length;
  const unmatchedBohPersonDays = unmatchedBohLabor.length;
  const bohDenom = matchedBohPersonDays + unmatchedBohPersonDays;
  const bohMatchRate = bohDenom > 0 ? matchedBohPersonDays / bohDenom : 0;
  const rosterCoverage =
    roster.length > 0 ? matchedNames.size / roster.length : 0;

  const bohLaborEntryCount = (labor.entries || []).filter((e) => isFoodStationJob(e.jobName)).length;

  return {
    venue,
    weekLabel,
    builtAt: new Date().toISOString(),
    scores: {
      bohMatchRate: +bohMatchRate.toFixed(3),
      rosterCoverage: +rosterCoverage.toFixed(3),
      stationConflicts: stationConflicts.length,
      matchedBohPersonDays,
      unmatchedBohPersonDays,
      fohLaborIgnored: fohLaborIgnored.length,
      supportBohUnmatched: supportBohLabor.length,
      rosterTotal: roster.length,
      rosterMatchedPeople: matchedNames.size,
      bohLaborEntries: bohLaborEntryCount,
      toastLaborEntries: (labor.entries || []).length,
    },
    notes:
      venue === 'ava_coconut_grove' && bohLaborEntryCount === 0
        ? 'AVA CG: Toast labor has no BOH punches this week (FOH-only). Viktor roster is present; heads stay 0 until BOH clocks into the CG Toast restaurant.'
        : null,
    matched: matched.sort((a, b) => a.day.localeCompare(b.day) || a.fteName.localeCompare(b.fteName)),
    stationConflicts,
    rosterUnused,
    unmatchedBohLabor,
    supportBohUnmatched: supportBohLabor.slice(0, 80),
    fohLaborIgnored: fohLaborIgnored.slice(0, 100),
    legacyUnmatchedRoster: unmatchedRoster,
  };
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml(weekLabel, venues) {
  const rows = venues
    .map((v) => {
      const s = v.scores;
      const rateCls = s.bohMatchRate >= 0.85 ? 'ok' : s.bohMatchRate >= 0.5 ? 'warn' : 'bad';
      return `<tr>
        <td><a href="#${esc(v.venue)}">${esc(v.venue)}</a></td>
        <td class="${rateCls}">${(s.bohMatchRate * 100).toFixed(1)}%</td>
        <td>${(s.rosterCoverage * 100).toFixed(1)}%</td>
        <td>${s.stationConflicts}</td>
        <td>${s.matchedBohPersonDays}</td>
        <td>${s.unmatchedBohPersonDays}</td>
        <td>${s.rosterMatchedPeople}/${s.rosterTotal}</td>
        <td>${s.bohLaborEntries}</td>
      </tr>`;
    })
    .join('\n');

  const sections = venues
    .map((v) => {
      const conflictRows = (v.stationConflicts || [])
        .slice(0, 40)
        .map(
          (c) =>
            `<tr><td>${esc(c.day)}</td><td>${esc(c.fteName)}</td><td>${esc(c.fteFamily)}</td><td>${esc(
              (c.toastJobs || []).join(', ')
            )}</td><td>${esc((c.toastFamilies || []).join(', '))}</td></tr>`
        )
        .join('') || '<tr><td colspan="5">None</td></tr>';

      const unusedRows = (v.rosterUnused || [])
        .slice(0, 40)
        .map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.matrix)}</td><td>${esc(r.position)}</td></tr>`)
        .join('') || '<tr><td colspan="3">None</td></tr>';

      const unmatchedRows = (v.unmatchedBohLabor || [])
        .slice(0, 40)
        .map(
          (u) =>
            `<tr><td>${esc(u.day)}</td><td>${esc(u.employeeName || u.payrollName)}</td><td>${esc(
              (u.jobs || []).join(', ')
            )}</td><td>${esc(u.hours)}</td></tr>`
        )
        .join('') || '<tr><td colspan="4">None</td></tr>';

      const matchedSample = (v.matched || [])
        .slice(0, 30)
        .map(
          (m) =>
            `<tr><td>${esc(m.day)}</td><td>${esc(m.fteName)}</td><td>${esc(m.fteFamily)}</td><td>${esc(
              (m.toastJobs || []).join(', ')
            )}</td><td>${esc(m.hours)}</td><td>${esc(
              (m.timeEntries || [])
                .map((t) => `${t.inDate || '?'}→${t.outDate || '?'} (${t.jobName || ''})`)
                .join('; ')
            )}</td></tr>`
        )
        .join('') || '<tr><td colspan="6">None</td></tr>';

      return `
<section id="${esc(v.venue)}">
  <h2>${esc(v.venue)}</h2>
  ${v.notes ? `<p class="note">${esc(v.notes)}</p>` : ''}
  <p>BOH match ${(v.scores.bohMatchRate * 100).toFixed(1)}% · roster coverage ${(
        v.scores.rosterCoverage * 100
      ).toFixed(1)}% · conflicts ${v.scores.stationConflicts}</p>

  <h3>Station conflicts (FTE position vs Toast job family)</h3>
  <table><thead><tr><th>Day</th><th>Name</th><th>FTE family</th><th>Toast jobs</th><th>Job families</th></tr></thead><tbody>${conflictRows}</tbody></table>

  <h3>Roster unused (on Viktor, no matched Toast day)</h3>
  <table><thead><tr><th>Name</th><th>Family</th><th>Position</th></tr></thead><tbody>${unusedRows}</tbody></table>

  <h3>Unmatched BOH labor (Toast BOH punch, no FTE name hit)</h3>
  <table><thead><tr><th>Day</th><th>Toast name</th><th>Jobs</th><th>Hours</th></tr></thead><tbody>${unmatchedRows}</tbody></table>

  <h3>Matched sample (first 30) + time entries</h3>
  <table><thead><tr><th>Day</th><th>FTE name</th><th>Family</th><th>Toast jobs</th><th>Hours</th><th>Punches</th></tr></thead><tbody>${matchedSample}</tbody></table>
</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Staffing balance ${esc(weekLabel)}</title>
<style>
  body{font-family:Segoe UI,system-ui,sans-serif;margin:24px;color:#1a1a1a;background:#fafafa}
  h1{font-size:22px;margin:0 0 8px}
  .meta{color:#666;margin-bottom:20px}
  table{border-collapse:collapse;width:100%;margin:8px 0 24px;background:#fff;font-size:13px}
  th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f0f0f0}
  .ok{color:#0a7a32;font-weight:600}
  .warn{color:#a15c00;font-weight:600}
  .bad{color:#b00020;font-weight:600}
  .note{background:#fff3cd;border:1px solid #e6d59a;padding:8px 12px;border-radius:4px}
  section{margin-top:36px;padding-top:12px;border-top:2px solid #eee}
  a{color:#0b5fff}
</style>
</head>
<body>
<h1>Toast ↔ FTE match balance — ${esc(weekLabel)}</h1>
<p class="meta">Private local report (names). Not published to GitHub Pages. Generated ${esc(
    new Date().toISOString()
  )}</p>
<table>
<thead><tr><th>Venue</th><th>BOH match</th><th>Roster coverage</th><th>Conflicts</th><th>Matched person-days</th><th>Unmatched BOH</th><th>People matched</th><th>BOH punches</th></tr></thead>
<tbody>${rows}</tbody>
</table>
${sections}
</body>
</html>`;
}

function main() {
  const weekLabel = process.argv[2];
  if (!weekLabel || !/^\d{4}-W\d{2}$/.test(weekLabel)) {
    throw new Error('Usage: node build-staffing-balance.cjs 2026-W34 [venue]');
  }
  const only = process.argv[3] ? resolveVenueSlug(process.argv[3]) || process.argv[3] : null;
  const venues = only ? [only] : STAFFING_VENUES;

  const outDir = path.join(ROOT, 'data', weekLabel);
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const venue of venues) {
    try {
      const bal = buildVenueBalance(venue, weekLabel);
      const outPath = path.join(outDir, `staffing-balance-${venue}.json`);
      fs.writeFileSync(outPath, JSON.stringify(bal, null, 2));
      console.log(
        `[${venue}] bohMatch=${(bal.scores.bohMatchRate * 100).toFixed(1)}% roster=${(
          bal.scores.rosterCoverage * 100
        ).toFixed(1)}% conflicts=${bal.scores.stationConflicts} → ${outPath}`
      );
      if (bal.notes) console.log(`  NOTE: ${bal.notes}`);
      results.push(bal);
    } catch (e) {
      console.error(`[${venue}] ${e.message}`);
    }
  }

  if (!only && results.length) {
    const htmlPath = path.join(outDir, 'staffing-balance.html');
    fs.writeFileSync(htmlPath, renderHtml(weekLabel, results));
    console.log(`Wrote ${htmlPath}`);
  }

  if (!results.length) process.exit(1);
}

main();
