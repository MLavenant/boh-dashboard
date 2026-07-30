/**
 * GitHub-hosted Actions entrypoint for BOH weekly fetch.
 * Portable paths, session checks, then weekly-save.js (ESM).
 *
 * Usage:
 *   node weekly-save-cloud.cjs
 *   node weekly-save-cloud.cjs 2026-W30
 *
 * Env: BOH_ROOT, OT_USERNAME, OT_PASSWORD, TOAST_SESSION_FILE, …
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = process.env.BOH_ROOT || __dirname;
process.chdir(ROOT);

const FB_DB = 'rdg-dj-dashboard-default-rtdb.firebaseio.com';
const SESSION_FILE = process.env.TOAST_SESSION_FILE || path.join(ROOT, 'toast-session.json');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function fbPut(fbPath, payload) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: FB_DB,
      path: fbPath + '.json',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res(r.statusCode));
    });
    req.on('error', rej);
    req.write(body);
    req.end();
  });
}

async function markFail(message) {
  const now = new Date();
  const payload = {
    ok: false,
    at: now.toISOString(),
    atLocal: now.toLocaleString('en-US', { timeZone: 'America/New_York' }),
    schedule: 'Mon ~8:30 AM ET (GitHub Actions; backup ~9:00 AM)',
    what: 'BOH weekly Toast+OT → processed venue JSON → Firebase + Pages',
    message,
    source: 'bohWeekly'
  };
  try {
    await fbPut('/rdg/scrapeStatus/bohWeekly', payload);
  } catch (e) {
    log(`Firebase status write failed: ${e.message}`);
  }
}

async function main() {
  log(`BOH weekly cloud start · ROOT=${ROOT}`);

  if (!fs.existsSync(SESSION_FILE)) {
    const msg = `Missing Toast session at ${SESSION_FILE}. Refresh GitHub secret TOAST_SESSION_GZIP_B64`;
    log(msg);
    await markFail(msg);
    process.exit(1);
  }

  if (!process.env.OT_USERNAME || !process.env.OT_PASSWORD) {
    // Load .env if present (local / runner file)
    try {
      require('dotenv').config({ path: path.join(ROOT, '.env'), override: true });
    } catch (_) {}
  }
  if (!process.env.OT_USERNAME || !process.env.OT_PASSWORD) {
    const msg = 'OT_USERNAME / OT_PASSWORD not set in GitHub Actions secrets';
    log(msg);
    await markFail(msg);
    process.exit(1);
  }

  const weekArg = process.argv[2] && process.argv[2] !== 'last' ? process.argv[2] : '';
  // weekly-save.js always computes last full ISO week; weekArg reserved for future pin
  if (weekArg) log(`Note: week pin '${weekArg}' — weekly-save currently always fetches last full ISO week`);

  const env = {
    ...process.env,
    BOH_ROOT: ROOT,
    TOAST_SESSION_FILE: SESSION_FILE,
    DATA_DIR: process.env.DATA_DIR || path.join(ROOT, 'data'),
  };

  const r = spawnSync(process.execPath, [path.join(ROOT, 'weekly-save.js')], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  if (r.status !== 0) {
    await markFail(`weekly-save.js exited ${r.status}`);
    process.exit(r.status || 1);
  }

  log('weekly-save.js completed OK');
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await markFail(String(e.message || e));
  process.exit(1);
});
