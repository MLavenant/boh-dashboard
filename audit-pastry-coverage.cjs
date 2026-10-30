'use strict';
/**
 * Audit: Toast prep-station Pastry routes vs dashboard stationHourItems counts.
 * Usage: node _audit-pastry-coverage.cjs [weekLabel]
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const WEEK = process.argv[2] || '2026-W43';
const MAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'item-station-map.json'), 'utf8'));

const VENUES = [
  { slug: 'claudie', mapKey: 'claudie', prep: 'prep-stations-claudie.json' },
  { slug: 'casa_neos', mapKey: 'casa_neos', prep: 'prep-stations-casa_neos.json' },
  { slug: 'ava_coconut_grove', mapKey: 'ava_cg', prep: 'prep-stations-ava_cg.json' },
  { slug: 'ava_winter_park', mapKey: 'ava_wp', prep: 'prep-stations-ava_wp.json' },
  { slug: 'mila', mapKey: 'mila', prep: 'prep-stations-mila.json' },
];

function isPastryStation(s) {
  return /pastry/i.test(String(s || ''));
}

function loadItems(slug) {
  const p = path.join(ROOT, 'data', WEEK, `item-details-${slug}.json`);
  if (!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return raw.items || raw || [];
}

function loadWeek(slug) {
  const p = path.join(ROOT, `${slug}-data-${WEEK}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function soldQty(items) {
  const m = new Map();
  const groups = new Map();
  for (const r of items) {
    const n = r.menuItem || r['Menu Item'];
    if (!n) continue;
    m.set(n, (m.get(n) || 0) + (Number(r.qty) || 1));
    groups.set(n, r.menuGroup || r['Menu Group'] || '');
  }
  return { sold: m, groups };
}

function countedPastry(week) {
  const m = new Map();
  const byStation = {};
  for (const [st, days] of Object.entries((week && week.stationHourItems) || {})) {
    if (!isPastryStation(st)) continue;
    byStation[st] = 0;
    for (const hours of Object.values(days || {})) {
      for (const ev of Object.values(hours || {})) {
        for (const e of ev || []) {
          const q = e.q || 1;
          m.set(e.n, (m.get(e.n) || 0) + q);
          byStation[st] += q;
        }
      }
    }
  }
  return { counted: m, byStation };
}

function pastryFromPrep(prepPath) {
  const full = path.join(ROOT, 'data', prepPath);
  if (!fs.existsSync(full)) return { items: new Map(), missingFile: true };
  const prep = JSON.parse(fs.readFileSync(full, 'utf8'));
  const items = new Map();
  for (const it of prep.items || []) {
    const sts = [...(it.stations || []), ...(it.stationsRaw || [])];
    if (!sts.some(isPastryStation)) continue;
    items.set(it.menuItem, {
      stations: it.stations || [],
      stationsRaw: it.stationsRaw || [],
      menu: it.menu || '',
      group: it.group || '',
    });
  }
  return { items, missingFile: false, scrapedAt: prep.scrapedAt };
}

function pastryFromMap(mapKey) {
  const block = MAP[mapKey] || {};
  const items = new Map();
  for (const [name, info] of Object.entries(block)) {
    if ((info.stations || []).some(isPastryStation)) {
      items.set(name, info);
    }
  }
  return items;
}

/** Foreign brand filter (mirror process-venue-data). */
function isForeign(slug, name) {
  const n = String(name || '').trim();
  if (slug !== 'mila' && /^(M|MB|MM)[\s_-]/i.test(n)) return true;
  if (!/^ava_/i.test(slug) && /^A-/i.test(n)) return true;
  return false;
}

const report = [];

for (const v of VENUES) {
  const { sold, groups } = soldQty(loadItems(v.slug));
  const week = loadWeek(v.slug);
  const { counted, byStation } = countedPastry(week);
  const prep = pastryFromPrep(v.prep);
  const mapPastry = pastryFromMap(v.mapKey);

  // Also: counted on any station (for multi-station savory that lists Pastry incidentally)
  const countedAnywhere = new Map();
  if (week && week.stationHourItems) {
    for (const [, days] of Object.entries(week.stationHourItems)) {
      for (const hours of Object.values(days || {})) {
        for (const ev of Object.values(hours || {})) {
          for (const e of ev || []) {
            countedAnywhere.set(e.n, (countedAnywhere.get(e.n) || 0) + (e.q || 1));
          }
        }
      }
    }
  }

  const missed = []; // sold + Toast pastry route, not fully counted on Pastry
  const primaryElsewhere = []; // pastry in Toast route but attributed to another cook station (savory multi-print)
  const intentionalSkip = [];
  for (const [name, meta] of prep.items) {
    const q = sold.get(name) || 0;
    if (q <= 0) continue;
    const c = counted.get(name) || 0;
    if (c + 0.01 >= q) continue;
    const row = {
      name,
      sold: q,
      counted: c,
      gap: +(q - c).toFixed(2),
      menu: meta.menu,
      group: meta.group,
      stations: meta.stations,
      foreign: isForeign(v.slug, name),
      elsewhere: countedAnywhere.get(name) || 0,
    };
    if (row.foreign) intentionalSkip.push(row);
    else if (row.elsewhere + 0.01 >= q && !/dessert|pastry|cake|all\s*in/i.test(name)) {
      primaryElsewhere.push(row);
    } else missed.push(row);
  }
  missed.sort((a, b) => b.gap - a.gap);
  primaryElsewhere.sort((a, b) => b.gap - a.gap);
  intentionalSkip.sort((a, b) => b.gap - a.gap);

  // Sold dessert-like with NO pastry route in prep/map and not counted on pastry
  const orphanDessert = [];
  for (const [name, q] of sold) {
    if (q <= 0) continue;
    if (counted.has(name)) continue;
    if (prep.items.has(name) || mapPastry.has(name)) continue;
    const g = groups.get(name) || '';
    if (
      !/dessert|pastry|cake|baklava|brulee|gelato|scoop|french toast|mille|crema|platter|spoon|ice cream|sorbet|pastilla|cakage|berry|waffle|pancake|churro|cookie|tiramisu|panna|mousse|souffle|\btart\b|\bpie\b|baba|kouigno|donut|doughnut|cannoli|profiterole|eclair|éclair/i.test(
        name
      ) &&
      !/dessert|pastry/i.test(g)
    ) {
      continue;
    }
    if (isForeign(v.slug, name)) continue;
    orphanDessert.push({ name, sold: q, group: g, map: mapPastry.get(name) || null });
  }
  orphanDessert.sort((a, b) => b.sold - a.sold);

  // Prep pastry SKUs never sold this week (coverage OK)
  let prepPastrySold = 0;
  let prepPastrySkuSold = 0;
  for (const name of prep.items.keys()) {
    const q = sold.get(name) || 0;
    if (q > 0) {
      prepPastrySkuSold++;
      prepPastrySold += q;
    }
  }

  const countedQty = [...counted.values()].reduce((a, b) => a + b, 0);
  const gapQty = missed.reduce((a, r) => a + r.gap, 0);

  report.push({
    venue: v.slug,
    scrapedAt: prep.scrapedAt || null,
    prepPastrySkus: prep.items.size,
    mapPastrySkus: mapPastry.size,
    countedSkus: counted.size,
    countedQty,
    byStation,
    prepPastrySkuSold,
    prepPastrySoldQty: prepPastrySold,
    missedCount: missed.length,
    missedQty: gapQty,
    missed,
    primaryElsewhere,
    foreignSkipped: intentionalSkip,
    orphanDessert: orphanDessert.slice(0, 25),
  });
}

console.log(`=== Pastry coverage audit · ${WEEK} ===\n`);
for (const r of report) {
  console.log(`── ${r.venue} ──`);
  console.log(`  Toast prep Pastry SKUs: ${r.prepPastrySkus} (sold this week: ${r.prepPastrySkuSold} / qty ${r.prepPastrySoldQty})`);
  console.log(`  Map Pastry SKUs: ${r.mapPastrySkus}`);
  console.log(`  Dashboard counted: ${r.countedSkus} SKUs / qty ${r.countedQty}  stations=${JSON.stringify(r.byStation)}`);
  if (r.missedCount === 0) {
    console.log(`  ✅ All sold Toast-Pastry-routed dessert/pastry items are counted on Pastry`);
  } else {
    console.log(`  ❌ MISSING on Pastry ${r.missedCount} SKUs / ${r.missedQty} qty:`);
    for (const m of r.missed) {
      console.log(`     -${m.gap}\t${m.counted}/${m.sold}\t[${m.menu}/${m.group}]\t${m.name}\t→ ${JSON.stringify(m.stations)}`);
    }
  }
  if (r.primaryElsewhere && r.primaryElsewhere.length) {
    console.log(`  ℹ Multi-station savory (Pastry also prints, counted on primary cook station):`);
    for (const m of r.primaryElsewhere) {
      console.log(`     ${m.name} sold=${m.sold} elsewhere=${m.elsewhere} stations=${JSON.stringify(m.stations)}`);
    }
  }
  if (r.foreignSkipped.length) {
    console.log(`  ⏭ Foreign-brand skipped (intentional): ${r.foreignSkipped.map((x) => `${x.name}(${x.sold})`).join(', ')}`);
  }
  if (r.orphanDessert.length) {
    console.log(`  ⚠ Sold dessert-like with NO Pastry route in prep/map (may need Toast routing or map):`);
    for (const o of r.orphanDessert.slice(0, 15)) {
      console.log(`     ${o.sold}\t${o.group}\t${o.name}`);
    }
  }
  console.log('');
}

const out = path.join(ROOT, 'data', WEEK, 'pastry-coverage-audit.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ week: WEEK, generatedAt: new Date().toISOString(), venues: report }, null, 2));
console.log(`Wrote ${out}`);
