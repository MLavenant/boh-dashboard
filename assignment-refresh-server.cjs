'use strict';
/**
 * Local helper for Assignment → "Refresh from Toast".
 * Dashboard button POSTs here; we scrape prep stations, merge REF targets,
 * reprocess the selected week, and rebuild dashboard.html.
 *
 * Run:  node assignment-refresh-server.cjs
 * Keep this window open while using the dashboard Refresh button.
 */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 3855;

const VENUE_TO_SCRAPE = {
  claudie: 'claudie',
  casa_neos: 'casa_neos',
  ava_cg: 'ava_cg',
  ava_wp: 'ava_wp',
  mila: null, // not ready
};

const VENUE_TO_PROCESS = {
  claudie: 'claudie',
  casa_neos: 'casa_neos',
  ava_cg: 'ava_coconut_grove',
  ava_wp: 'ava_winter_park',
  mila: 'mila',
};

let busy = false;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); process.stdout.write(d); });
    child.stderr.on('data', d => { out += d.toString(); process.stderr.write(d); });
    child.on('close', code => {
      if (code === 0) resolve(out);
      else reject(new Error((cmd + ' ' + args.join(' ')) + ' exited ' + code + '\n' + out.slice(-800)));
    });
  });
}

function latestWeek() {
  const dataRoot = path.join(ROOT, 'data');
  const weeks = fs.readdirSync(dataRoot).filter(d => /^\d{4}-W\d{2}$/.test(d)).sort();
  return weeks[weeks.length - 1] || null;
}

function countMapped(venueKey) {
  try {
    const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'item-station-map.json'), 'utf8'));
    return Object.keys(map[venueKey] || {}).length;
  } catch {
    return 0;
  }
}

async function refreshAssignment({ venue, week }) {
  const scrapeKey = VENUE_TO_SCRAPE[venue];
  const processKey = VENUE_TO_PROCESS[venue];
  if (!processKey) throw new Error('Unknown venue: ' + venue);
  if (!scrapeKey) throw new Error(venue + ' prep scrape is not configured yet (MILA pending).');

  const weekKey = week && /^\d{4}-W\d{2}$/.test(week) ? week : latestWeek();
  if (!weekKey) throw new Error('No week data folders found under data/');

  console.log('\n=== Assignment refresh ===');
  console.log('venue=', venue, 'scrape=', scrapeKey, 'process=', processKey, 'week=', weekKey);

  // 1) Scrape Toast Bulk Editor prep stations / menu items for this venue
  await run('node', ['scrape-prep-stations-all.cjs', scrapeKey]);

  // 2) Merge REF targets + Toast stations (preserves targets)
  await run('node', ['extract-item-stations.cjs']);

  // 3) Reprocess kitchen timing week (hour profile + station metrics)
  await run('node', ['process-venue-data.cjs', processKey, weekKey]);

  // 4) Rebuild dashboard
  await run('node', ['build-unified-v2.cjs']);

  return {
    ok: true,
    venue,
    week: weekKey,
    items: countMapped(venue === 'casa_neos' ? 'casa_neos' : venue),
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, busy }));
    return;
  }

  if (req.method === 'POST' && req.url === '/refresh-assignment') {
    if (busy) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Refresh already running' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      busy = true;
      try {
        const payload = body ? JSON.parse(body) : {};
        const result = await refreshAssignment(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error(e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || String(e) }));
      } finally {
        busy = false;
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Assignment refresh helper listening on http://127.0.0.1:' + PORT);
  console.log('Keep this window open, then click "Refresh from Toast" in the Assignment tab.');
});
