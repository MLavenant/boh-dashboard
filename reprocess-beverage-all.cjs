'use strict';
/**
 * Reprocess beverage (Special/Classic) for all venues × all weeks that have kitchen + item-details.
 * Usage: node reprocess-beverage-all.cjs [weekKey]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const VENUES = ['mila', 'claudie', 'casa_neos', 'ava_coconut_grove', 'ava_winter_park'];
const weekFilter = process.argv[2] || null;

const weeks = fs.readdirSync(path.join(ROOT, 'data'))
  .filter(d => /^\d{4}-W\d{2}$/.test(d))
  .sort();
const targets = weekFilter ? weeks.filter(w => w === weekFilter) : weeks;
if (!targets.length) {
  console.error('No weeks found');
  process.exit(1);
}

let ok = 0;
let fail = 0;
for (const week of targets) {
  for (const venue of VENUES) {
    const kt = path.join(ROOT, 'data', week, `kitchen-timing-${venue}.json`);
    const id = path.join(ROOT, 'data', week, `item-details-${venue}.json`);
    if (!fs.existsSync(kt) || !fs.existsSync(id)) {
      console.log(`skip ${venue} ${week} (missing kt/item-details)`);
      continue;
    }
    console.log(`\n── ${venue} ${week} ──`);
    const r = spawnSync(process.execPath, ['process-venue-data.cjs', venue, week], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    if (r.stdout) process.stdout.write(r.stdout.split('\n').filter(l => /Beverage|Item details|Wrote|stations=/.test(l)).join('\n') + '\n');
    if (r.status !== 0) {
      fail++;
      console.error(`FAIL ${venue} ${week}`, (r.stderr || '').slice(0, 400));
    } else {
      ok++;
    }
  }
}
console.log(`\nDone. ok=${ok} fail=${fail}`);
process.exit(fail ? 1 : 0);
