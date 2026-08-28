/**
 * Rebuild station staffing for every week that has labor + FTE roster + venue data.
 * Usage: node rebuild-staffing-ytd.cjs [--from 2026-W01] [--to 2026-W34]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { STAFFING_VENUES, listIsoWeeks } = require('./boh-staffing-shared.cjs');

const ROOT = process.env.BOH_ROOT || __dirname;

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
  const weeks = listIsoWeeks(args.from, args.to).map((w) => w.weekKey);
  const summary = [];

  for (const week of weeks) {
    let ok = 0;
    let fail = 0;
    for (const venue of STAFFING_VENUES) {
      const need = [
        path.join(ROOT, 'data', 'fte', `fte-roster-${week}.json`),
        path.join(ROOT, 'data', week, `labor-${venue}.json`),
        path.join(ROOT, `station-family-map-${venue}.json`),
        path.join(ROOT, `${venue}-data-${week}.json`),
      ];
      if (need.some((p) => !fs.existsSync(p))) {
        fail++;
        continue;
      }
      const r = spawnSync(process.execPath, ['build-station-staffing.cjs', venue, week], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      if (r.status === 0) ok++;
      else {
        fail++;
        console.warn(`${week} ${venue}: ${(r.stderr || r.stdout || '').slice(0, 200)}`);
      }
    }
    console.log(`${week}: staffing ok=${ok} skip/fail=${fail}`);
    summary.push({ week, ok, fail });
  }

  fs.mkdirSync(path.join(ROOT, 'data', 'fte'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'data', 'fte', 'staffing-ytd-rebuild-status.json'),
    JSON.stringify({ at: new Date().toISOString(), summary }, null, 2)
  );
}

main();
