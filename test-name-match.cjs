/**
 * Regression tests for Toast/Harri ↔ FTE name matching.
 *
 *   node test-name-match.cjs
 *   node test-name-match.cjs --week 2026-W36
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  nameKey,
  scoreNameMatch,
  namesMatch,
  bestRosterMatch,
  bestMatchFromNames,
  lookupByFuzzyName,
  STAFFING_VENUES,
  NAME_MATCH_THRESHOLD,
} = require('./boh-staffing-shared.cjs');

const ROOT = process.env.BOH_ROOT || __dirname;
let failed = 0;
let passed = 0;

function ok(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function score(a, b) {
  return scoreNameMatch(nameKey(a), nameKey(b));
}

function section(title) {
  console.log(`\n== ${title}`);
}

section('Unit: short Harri ↔ full FTE legal names');
const SHOULD_MATCH = [
  ['Jorge Ayala', 'Ayala Flores, Jorge Dario'],
  ['Ayala, Jorge', 'Ayala Flores, Jorge Dario'],
  ['Jorge Dario Ayala', 'Ayala Flores, Jorge Dario'],
  ['Christopher Summerset', 'Summerset, Christopher Lee'],
  ['Summerset, Christopher', 'Summerset, Christopher Lee'],
  ['Summerset, Christopher Lee', 'Christopher Summerset'],
  ['Elder Sanchez', 'Sanchez Toruno, Elder Jair'],
  ['Sanchez Toruno, Elder', 'Elder Sanchez Toruno'],
  ['Maritza Vera', 'Vera Jordan, Maritza Graciela'],
  ['Miladys Garcia', 'Garcia Ferrera, Miladys'],
  ['Juan Pablo Garcia', 'Garcia Bechara, Juan Pablo'],
  ['Alexandre Hara', 'Hara Osawa, Alexandre'],
  ['Alessandro Morelli', 'Linke, Alessandro Luigi Morelli'],
  ['Alessandro Luigi Morelli Linke', 'Linke, Alessandro Luigi Morelli'],
];
for (const [a, b] of SHOULD_MATCH) {
  const s = score(a, b);
  ok(s >= NAME_MATCH_THRESHOLD, `${a} ↔ ${b} score=${s} (≥${NAME_MATCH_THRESHOLD})`);
}

section('Unit: must NOT collide');
const SHOULD_NOT = [
  ['Jorge Ayala', 'Pacheco Gomez, Jorge'],
  ['Jorge Ayala', 'Garcia Bechara, Juan Pablo'],
  ['Christopher Summerset', 'Sanchez Toruno, Elder Jair'],
  ['Maria Garcia', 'Garcia Ferrera, Miladys'],
];
for (const [a, b] of SHOULD_NOT) {
  const s = score(a, b);
  ok(s < NAME_MATCH_THRESHOLD, `${a} ≉ ${b} score=${s} (<${NAME_MATCH_THRESHOLD})`);
}

section('Unit: helpers bestMatchFromNames / lookupByFuzzyName');
{
  const roster = [
    { name: 'Ayala Flores, Jorge Dario', matrix: 'Raw', ...nameKey('Ayala Flores, Jorge Dario') },
    { name: 'Summerset, Christopher Lee', matrix: 'Saute', ...nameKey('Summerset, Christopher Lee') },
    { name: 'Pacheco Gomez, Jorge', matrix: 'Robata', ...nameKey('Pacheco Gomez, Jorge') },
  ];
  const hit = bestMatchFromNames(['Ayala, Jorge', 'Jorge Ayala'], roster);
  ok(hit && hit.row.name === 'Ayala Flores, Jorge Dario', `bestMatchFromNames → ${hit?.row?.name}`);
  const assign = lookupByFuzzyName(
    { 'Ayala Flores, Jorge Dario': 'Raw', 'Summerset, Christopher Lee': 'Saute' },
    ['Jorge Ayala']
  );
  ok(assign && assign.value === 'Raw', `lookupByFuzzyName Jorge Ayala → ${assign?.value}`);
  const assign2 = lookupByFuzzyName(
    { 'Summerset, Christopher Lee': 'Saute' },
    ['Summerset, Christopher']
  );
  ok(assign2 && assign2.value === 'Saute', `lookupByFuzzyName Summerset, Christopher → ${assign2?.value}`);
}

section('Unit: nameKey comma + multi-part last');
{
  const a = nameKey('Ayala Flores, Jorge Dario');
  ok(a.tokens[0] === 'jorge' && a.tokens.includes('ayala') && a.tokens.includes('flores'), `tokens=${a.tokens.join('|')}`);
  const b = nameKey('Jorge Ayala');
  ok(b.tokens.join(' ') === 'jorge ayala', `short tokens=${b.tokens.join('|')}`);
  ok(namesMatch(a, b), 'namesMatch(full, short)');
}

const weekArgIdx = process.argv.indexOf('--week');
const weekLabel =
  (weekArgIdx >= 0 && process.argv[weekArgIdx + 1]) ||
  (() => {
    const weeks = fs
      .readdirSync(path.join(ROOT, 'data'))
      .filter((d) => /^\d{4}-W\d{2}$/.test(d))
      .sort();
    return weeks[weeks.length - 1] || '2026-W36';
  })();

section(`Integration: labor × FTE join (${weekLabel})`);
const rosterFile = path.join(ROOT, 'data', 'fte', `fte-roster-${weekLabel}.json`);
if (!fs.existsSync(rosterFile)) {
  ok(false, `missing ${rosterFile}`);
} else {
  const rosterJson = JSON.parse(fs.readFileSync(rosterFile, 'utf8'));
  const KNOWN = [
    { venue: 'claudie', labor: ['Jorge Ayala', 'Ayala, Jorge'], fte: /ayala flores/i },
    { venue: 'claudie', labor: ['Christopher Summerset', 'Summerset, Christopher'], fte: /summerset/i },
    { venue: 'ava_coconut_grove', labor: ['Elder Sanchez Toruno', 'Elder Sanchez'], fte: /sanchez toruno/i },
    { venue: 'ava_coconut_grove', labor: ['Maritza Vera Jordan', 'Maritza Vera'], fte: /vera jordan/i },
  ];

  for (const venue of STAFFING_VENUES) {
    const rows = ((rosterJson.venues && rosterJson.venues[venue]) || []).map((r) => ({
      ...r,
      ...nameKey(r.name),
    }));
    const laborPath = path.join(ROOT, 'data', weekLabel, `labor-${venue}.json`);
    if (!rows.length || !fs.existsSync(laborPath)) {
      console.log(`  · skip ${venue} (no roster/labor)`);
      continue;
    }
    const labor = JSON.parse(fs.readFileSync(laborPath, 'utf8'));
    const people = new Map();
    for (const e of labor.entries || []) {
      const job = String(e.jobName || '');
      if (!/cook|cdp|chef|line|prep|pastry|sushi|robata|saute|fry|garde|expo|pizza|culinary/i.test(job)) {
        continue;
      }
      const key = (e.payrollName || e.employeeName || '').toLowerCase();
      if (!key) continue;
      if (!people.has(key)) {
        people.set(key, {
          payrollName: e.payrollName,
          employeeName: e.employeeName,
        });
      }
    }

    let matched = 0;
    let unmatched = 0;
    const misses = [];
    for (const p of people.values()) {
      const hit = bestMatchFromNames([p.payrollName, p.employeeName], rows);
      if (hit) matched += 1;
      else {
        unmatched += 1;
        if (misses.length < 8) {
          misses.push(p.payrollName || p.employeeName);
        }
      }
    }
    ok(
      people.size === 0 || matched + unmatched === people.size,
      `${venue}: ${matched} unique BOH names matched / ${unmatched} unmatched (of ${people.size})` +
        (people.size === 0 ? ' — no BOH punches in labor file' : '')
    );
    if (misses.length) console.log(`    unmatched sample: ${misses.join(' · ')}`);

    for (const k of KNOWN.filter((x) => x.venue === venue)) {
      const fteRow = rows.find((r) => k.fte.test(r.name));
      ok(!!fteRow, `${venue} FTE has ${k.fte}`);
      if (!fteRow) continue;
      const hit = bestMatchFromNames(k.labor, rows);
      ok(
        hit && hit.row.name === fteRow.name,
        `${venue}: ${k.labor[0]} → ${hit?.row?.name || 'NONE'} (expect ${fteRow.name})`
      );
    }
  }
}

section('Synthetic shortenings of every multi-part FTE name');
{
  const rosterJson = JSON.parse(fs.readFileSync(rosterFile, 'utf8'));
  let checked = 0;
  for (const venue of STAFFING_VENUES) {
    const rows = ((rosterJson.venues && rosterJson.venues[venue]) || []).map((r) => ({
      ...r,
      ...nameKey(r.name),
    }));
    for (const r of rows) {
      if (!r.name.includes(',')) continue;
      const [lastPart, firstPart] = r.name.split(',').map((x) => x.trim());
      const first = (firstPart || '').split(/\s+/)[0];
      const primaryLast = (lastPart || '').split(/\s+/)[0];
      if (!first || !primaryLast) continue;
      const shortA = `${first} ${primaryLast}`;
      const shortB = `${primaryLast}, ${first}`;
      const hit = bestMatchFromNames([shortA, shortB], rows);
      ok(
        hit && hit.row.name === r.name,
        `${venue}: "${shortA}" / "${shortB}" → ${r.name} (score ${hit?.score})`
      );
      checked += 1;
    }
  }
  ok(checked > 0, `checked ${checked} multi-part FTE shortenings`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
