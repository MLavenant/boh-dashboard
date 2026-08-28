/**
 * Scan Toast labor time entries for people on generic jobs (Line Cook / CDP / …)
 * who still need a station-family assignment. Also lists auto-mapped jobs.
 *
 * Writes:
 *   data/fte/people-assignment-panel.json  — embedded into dashboard People tab
 *
 * Usage:
 *   node build-people-assignment-panel.cjs
 *   node build-people-assignment-panel.cjs --from 2026-W01 --to 2026-W34
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  FOOD_FAMILIES,
  nameKey,
  normalizeFoodFamily,
  listIsoWeeks,
  STAFFING_VENUES,
} = require('./boh-staffing-shared.cjs');

const ROOT = process.env.BOH_ROOT || __dirname;
const FTE_DIR = path.join(ROOT, 'data', 'fte');

function loadJson(p, fallback = null) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function parseArgs(argv) {
  const out = { from: '2026-W01', to: '2026-W34' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') out.from = argv[++i];
    else if (argv[i] === '--to') out.to = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobMap = loadJson(path.join(ROOT, 'toast-job-family-map.json'), {
    autoMap: {},
    needsAssignment: ['Line Cook', 'CDP', 'Chef de Partie', 'Cook'],
  });
  const personAssign = loadJson(path.join(ROOT, 'people-station-assignments.json'), {
    assignments: {},
  });
  const assignments = personAssign.assignments || {};

  const needsSet = new Set(
    (jobMap.needsAssignment || []).map((j) => String(j).trim().toLowerCase())
  );
  const autoMap = {};
  for (const [k, v] of Object.entries(jobMap.autoMap || {})) {
    autoMap[String(k).trim().toLowerCase()] = normalizeFoodFamily(v) || v;
  }

  const weeks = listIsoWeeks(args.from, args.to).map((w) => w.weekKey);
  /** key = nameKey.key → aggregate */
  const byPerson = new Map();

  function ensurePerson(displayName, payrollName) {
    const raw = payrollName || displayName;
    const nk = nameKey(raw);
    if (!nk.key) return null;
    if (!byPerson.has(nk.key)) {
      byPerson.set(nk.key, {
        key: nk.key,
        displayName: displayName || payrollName || nk.display,
        payrollName: payrollName || displayName || '',
        hours: 0,
        shiftCount: 0,
        jobs: {},
        venues: {},
        weeks: new Set(),
      });
    }
    const p = byPerson.get(nk.key);
    if (displayName && (!p.displayName || p.displayName.length < displayName.length)) {
      p.displayName = displayName;
    }
    if (payrollName) p.payrollName = payrollName;
    return p;
  }

  for (const week of weeks) {
    const weekDir = path.join(ROOT, 'data', week);
    if (!fs.existsSync(weekDir)) continue;
    for (const f of fs.readdirSync(weekDir).filter((x) => x.startsWith('labor-') && x.endsWith('.json'))) {
      const venue = f.replace(/^labor-/, '').replace(/\.json$/, '');
      let labor;
      try {
        labor = loadJson(path.join(weekDir, f));
      } catch {
        continue;
      }
      for (const e of labor.entries || []) {
        const job = String(e.jobName || '').trim();
        if (!job) continue;
        const jobLow = job.toLowerCase();
        const isNeeds = needsSet.has(jobLow);
        const autoFamily = autoMap[jobLow] || normalizeFoodFamily(job);
        if (!isNeeds && !autoFamily) continue;

        const p = ensurePerson(e.employeeName, e.payrollName);
        if (!p) continue;
        p.hours += e.hours || 0;
        p.shiftCount += 1;
        p.weeks.add(week);
        p.jobs[job] = (p.jobs[job] || 0) + (e.hours || 0);
        p.venues[venue] = (p.venues[venue] || 0) + (e.hours || 0);
        if (isNeeds) p.hasGenericJob = true;
        if (autoFamily) {
          p.autoFamilies = p.autoFamilies || {};
          p.autoFamilies[autoFamily] = (p.autoFamilies[autoFamily] || 0) + (e.hours || 0);
        }
      }
    }
  }

  // FTE matrix hint from latest roster (any week)
  const fteHint = new Map();
  for (const week of [...weeks].reverse()) {
    const roster = loadJson(path.join(FTE_DIR, `fte-roster-${week}.json`));
    if (!roster?.venues) continue;
    for (const [venue, rows] of Object.entries(roster.venues)) {
      for (const r of rows) {
        const nk = nameKey(r.name);
        if (!nk.key || !r.matrix) continue;
        if (!fteHint.has(nk.key)) {
          fteHint.set(nk.key, { matrix: r.matrix, position: r.position, venue, week });
        }
      }
    }
  }

  const needsAssignment = [];
  const autoAssigned = [];
  const alreadyAssigned = [];

  for (const p of byPerson.values()) {
    const assignedFamily =
      normalizeFoodFamily(assignments[p.key]) ||
      normalizeFoodFamily(assignments[p.payrollName]) ||
      normalizeFoodFamily(assignments[p.displayName]) ||
      null;
    const fte = fteHint.get(p.key) || null;
    const primaryJob = Object.entries(p.jobs).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const primaryJobLow = primaryJob.toLowerCase();
    const needs = needsSet.has(primaryJobLow);
    const autoFamily =
      autoMap[primaryJobLow] ||
      normalizeFoodFamily(primaryJob) ||
      (p.autoFamilies &&
        Object.entries(p.autoFamilies).sort((a, b) => b[1] - a[1])[0]?.[0]) ||
      null;

    let status = 'other';
    if (assignedFamily) status = 'assigned';
    else if (autoFamily && !needs) status = 'auto';
    else if (needs && fte?.matrix) status = 'fte_covered';
    else if (needs) status = 'needs_assignment';
    else if (autoFamily) status = 'auto';

    const row = {
      key: p.key,
      displayName: p.displayName,
      payrollName: p.payrollName,
      primaryJob,
      jobs: p.jobs,
      hours: +p.hours.toFixed(1),
      shiftCount: p.shiftCount,
      weekCount: p.weeks.size,
      venues: p.venues,
      assignedFamily,
      fteFamily: fte?.matrix || null,
      ftePosition: fte?.position || null,
      autoFamily,
      status,
    };

    if (row.status === 'needs_assignment') needsAssignment.push(row);
    else if (row.status === 'assigned' || row.status === 'fte_covered') {
      alreadyAssigned.push({
        ...row,
        assignedFamily: row.assignedFamily || row.fteFamily || null,
      });
    } else if (row.status === 'auto') autoAssigned.push(row);
  }

  const sortFn = (a, b) => b.hours - a.hours || a.displayName.localeCompare(b.displayName);
  needsAssignment.sort(sortFn);
  alreadyAssigned.sort(sortFn);
  autoAssigned.sort(sortFn);

  const panel = {
    generatedAt: new Date().toISOString(),
    from: args.from,
    to: args.to,
    families: FOOD_FAMILIES,
    staffingVenues: STAFFING_VENUES,
    needsAssignmentJobs: jobMap.needsAssignment,
    autoMap: jobMap.autoMap,
    counts: {
      needsAssignment: needsAssignment.length,
      assigned: alreadyAssigned.length,
      auto: autoAssigned.length,
    },
    needsAssignment,
    assigned: alreadyAssigned,
    autoAssigned: autoAssigned,
    allPeople: [...needsAssignment, ...alreadyAssigned, ...autoAssigned]
      .sort(sortFn)
      .map((r) => ({
        key: r.key,
        displayName: r.displayName,
        payrollName: r.payrollName,
        primaryJob: r.primaryJob,
        hours: r.hours,
        venues: r.venues,
        assignedFamily: r.assignedFamily,
        fteFamily: r.fteFamily,
        autoFamily: r.autoFamily,
        status: r.status,
      })),
  };

  // Deduplicate allPeople by key (assigned list may overlap)
  const seenAll = new Set();
  panel.allPeople = panel.allPeople.filter((r) => {
    if (seenAll.has(r.key)) return false;
    seenAll.add(r.key);
    return true;
  });
  panel.counts.totalUnique = panel.allPeople.length;

  fs.mkdirSync(FTE_DIR, { recursive: true });
  const outPath = path.join(FTE_DIR, 'people-assignment-panel.json');
  fs.writeFileSync(outPath, JSON.stringify(panel, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(
    `Needs assignment: ${needsAssignment.length} · Assigned: ${alreadyAssigned.length} · Auto-mapped: ${autoAssigned.length}`
  );
  if (needsAssignment.length) {
    console.log('Top unassigned:');
    for (const r of needsAssignment.slice(0, 15)) {
      console.log(
        `  ${r.displayName.padEnd(32)} ${r.primaryJob.padEnd(16)} ${String(r.hours).padStart(7)}h  fte=${r.fteFamily || '—'}`
      );
    }
  }
}

main();
