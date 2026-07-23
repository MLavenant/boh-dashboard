/**
 * Daily Toast refresh — also runs FourVenues first so both stay in sync
 * even when only this Task Scheduler job fires.
 * Schedule: daily ~8:30–9:15 AM America/New_York
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const ROOT = __dirname;

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York' });
  console.log(`[${ts} ET] ${msg}`);
}

function run(script, label) {
  log('→ ' + label);
  execSync(`node "${path.join(ROOT, script)}"`, { stdio: 'inherit', cwd: ROOT, shell: true });
}

(async () => {
  log('=== Daily FourVenues + Toast refresh Starting ===');
  let fvOk = true;
  let toastOk = true;

  try {
    run('fv-refresh-api.cjs', 'FourVenues Integrations API → Firebase');
  } catch (e) {
    fvOk = false;
    log('ERROR FourVenues: ' + String(e.message || e).split('\n')[0]);
    try {
      execSync(`node "${path.join(ROOT, 'fb-scrape-status.cjs')}" fourvenues fail "Daily FourVenues job failed"`, {
        stdio: 'inherit', cwd: ROOT, shell: true
      });
    } catch (_) {}
  }

  try {
    run('toast-bs-update.cjs', 'Toast BS Actual update');
  } catch (e) {
    toastOk = false;
    log('ERROR Toast: ' + String(e.message || e).split('\n')[0]);
  }

  const message = toastOk ? 'Toast BS Actual updated (daily)' : 'Toast BS daily job failed';
  try {
    execSync(
      `node "${path.join(ROOT, 'fb-scrape-status.cjs')}" toast ${toastOk ? 'ok' : 'fail'} "${message.replace(/"/g, '')}"`,
      { stdio: 'inherit', cwd: ROOT, shell: true }
    );
  } catch (e) {
    log('Status write error: ' + String(e.message || e).split('\n')[0]);
  }

  const ok = fvOk && toastOk;
  log(ok ? '=== Daily refresh Complete ===' : '=== Daily refresh Finished WITH ERRORS ===');
  process.exit(ok ? 0 : 1);
})();
