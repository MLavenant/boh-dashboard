'use strict';
/**
 * Strict check: every sold item Toast routes to Pastry must appear on Pastry in week JSON.
 * Usage: node _verify-all-pastry.cjs [week]
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

function isPastry(s) {
  return /pastry/i.test(String(s || ''));
}

function isForeign(slug, name) {
  const n = String(name || '').trim();
  if (slug !== 'mila' && /^(M|MB|MM)[\s_-]/i.test(n)) return true;
  if (!/^ava_/i.test(slug) && /^A-/i.test(n)) return true;
  return false;
}

/** Mirror process-venue pastry preference for multi-station. */
function primaryStation(stations, menuItem) {
  const ranked = (stations || []).filter((st) => st && !/no\s*print/i.test(st));
  const pastryHit = ranked.find((st) => isPastry(st));
  if (
    pastryHit &&
    (/dessert|pastry|cake|baklava|brulee|gelato|scoop|vacherin|platter|all\s*in|complimentary|tart|mousse|cheesecake|macaron|cookie|parfait|crema|lava|waffle|french toast|petit/i.test(
      String(menuItem || '')
    ) ||
      ranked.every((st) => /pastry|expo|pass/i.test(st)))
  ) {
    return pastryHit;
  }
  const cookFirst = ranked.find((st) => !/expo|pass/i.test(st));
  return cookFirst || ranked[0] || null;
}

const summary = [];

for (const v of VENUES) {
  const prepFile = path.join(ROOT, 'data', v.prep);
  const prep = JSON.parse(fs.readFileSync(prepFile, 'utf8'));
  const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', WEEK, `item-details-${v.slug}.json`), 'utf8')).items;
  const week = JSON.parse(fs.readFileSync(path.join(ROOT, `${v.slug}-data-${WEEK}.json`), 'utf8'));
  const map = MAP[v.mapKey] || {};

  const sold = new Map();
  for (const r of items) {
    if (!r.menuItem) continue;
    sold.set(r.menuItem, (sold.get(r.menuItem) || 0) + (Number(r.qty) || 1));
  }

  const countedOnPastry = new Map();
  for (const [st, days] of Object.entries(week.stationHourItems || {})) {
    if (!isPastry(st)) continue;
    for (const hours of Object.values(days || {})) {
      for (const ev of Object.values(hours || {})) {
        for (const e of ev || []) {
          countedOnPastry.set(e.n, (countedOnPastry.get(e.n) || 0) + (e.q || 1));
        }
      }
    }
  }

  const countedAnywhere = new Map();
  for (const [, days] of Object.entries(week.stationHourItems || {})) {
    for (const hours of Object.values(days || {})) {
      for (const ev of Object.values(hours || {})) {
        for (const e of ev || []) {
          countedAnywhere.set(e.n, (countedAnywhere.get(e.n) || 0) + (e.q || 1));
        }
      }
    }
  }

  // Union: prep scrape Pastry + map Pastry
  const toastPastry = new Map();
  for (const it of prep.items || []) {
    const sts = [...(it.stations || []), ...(it.stationsRaw || [])];
    if (!sts.some(isPastry)) continue;
    toastPastry.set(it.menuItem, {
      stations: it.stations || [],
      menu: it.menu,
      group: it.group,
      source: 'prep',
    });
  }
  for (const [name, info] of Object.entries(map)) {
    if (!(info.stations || []).some(isPastry)) continue;
    if (!toastPastry.has(name)) {
      toastPastry.set(name, { stations: info.stations, menu: '', group: '', source: 'map-only' });
    }
  }

  const gaps = [];
  const ok = [];
  const foreign = [];
  const primaryOther = [];

  for (const [name, meta] of toastPastry) {
    const q = sold.get(name) || 0;
    if (q <= 0) continue;
    if (isForeign(v.slug, name)) {
      foreign.push({ name, sold: q });
      continue;
    }
    const c = countedOnPastry.get(name) || 0;
    const primary = primaryStation(meta.stations, name);
    if (c + 0.01 >= q) {
      ok.push({ name, sold: q, counted: c });
      continue;
    }
    // If primary cook station is not pastry, item may correctly land elsewhere
    if (primary && !isPastry(primary)) {
      const elseQty = countedAnywhere.get(name) || 0;
      primaryOther.push({
        name,
        sold: q,
        onPastry: c,
        elsewhere: elseQty,
        primary,
        stations: meta.stations,
        source: meta.source,
      });
      // Still a gap for "everything that ends up on pastry" if Toast prints pastry too
      // User wants EVERYTHING that goes to pastry counted ON pastry — so multi-print should also hit pastry
      gaps.push({
        name,
        sold: q,
        onPastry: c,
        gap: +(q - c).toFixed(2),
        reason: 'multi-station-primary-elsewhere',
        primary,
        stations: meta.stations,
        menu: meta.menu,
        group: meta.group,
        source: meta.source,
      });
      continue;
    }
    gaps.push({
      name,
      sold: q,
      onPastry: c,
      gap: +(q - c).toFixed(2),
      reason: 'missing-on-pastry',
      primary,
      stations: meta.stations,
      menu: meta.menu,
      group: meta.group,
      source: meta.source,
    });
  }

  gaps.sort((a, b) => b.gap - a.gap);
  summary.push({
    venue: v.slug,
    toastPastrySkusSold: ok.length + gaps.length + foreign.length,
    okSkus: ok.length,
    okQty: ok.reduce((a, r) => a + r.sold, 0),
    gapSkus: gaps.length,
    gapQty: gaps.reduce((a, r) => a + r.gap, 0),
    foreign,
    gaps,
    primaryOther,
  });
}

console.log(`=== EVERYTHING → Pastry verification · ${WEEK} ===\n`);
let totalGaps = 0;
for (const r of summary) {
  totalGaps += r.gapSkus;
  console.log(`── ${r.venue} ──`);
  console.log(`  OK on Pastry: ${r.okSkus} SKUs / qty ${r.okQty}`);
  if (!r.gapSkus) {
    console.log(`  ✅ No gaps`);
  } else {
    console.log(`  ❌ GAPS ${r.gapSkus} SKUs / ${r.gapQty} qty not fully on Pastry:`);
    for (const g of r.gaps) {
      console.log(
        `     -${g.gap}\t${g.onPastry}/${g.sold}\t[${g.reason}]\tprimary=${g.primary}\t${g.name}\t${JSON.stringify(g.stations)}\t${g.menu}/${g.group}`
      );
    }
  }
  if (r.foreign.length) {
    console.log(`  ⏭ foreign skipped: ${r.foreign.map((f) => `${f.name}(${f.sold})`).join(', ')}`);
  }
  console.log('');
}

fs.writeFileSync(
  path.join(ROOT, 'data', WEEK, 'pastry-full-verify.json'),
  JSON.stringify({ week: WEEK, generatedAt: new Date().toISOString(), venues: summary }, null, 2)
);
console.log(totalGaps === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${totalGaps} gap SKUs)`);
process.exit(totalGaps ? 1 : 0);
