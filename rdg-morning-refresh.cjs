/**
 * Morning refresh — FourVenues + Toast together (~8:30 AM ET).
 * Used by Task Scheduler so both update even if GitHub Actions is delayed.
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
  log('=== RDG morning refresh (FourVenues + Toast) ===');
  let fvOk = true;
  let toastOk = true;

  try {
    run('fv-refresh-api.cjs', 'FourVenues Integrations API → Firebase');
  } catch (e) {
    fvOk = false;
    log('ERROR FourVenues: ' + String(e.message || e).split('\n')[0]);
    try {
      execSync(`node "${path.join(ROOT, 'fb-scrape-status.cjs')}" fourvenues fail "Morning FourVenues job failed"`, {
        stdio: 'inherit', cwd: ROOT, shell: true
      });
    } catch (_) {}
  }

  try {
    run('toast-bs-update.cjs', 'Toast BS Actual → dashboard');
  } catch (e) {
    toastOk = false;
    log('ERROR Toast: ' + String(e.message || e).split('\n')[0]);
  }

  try {
    const msg = toastOk ? 'Toast BS Actual updated (daily)' : 'Toast BS Actual morning job failed';
    execSync(
      `node "${path.join(ROOT, 'fb-scrape-status.cjs')}" toast ${toastOk ? 'ok' : 'fail'} "${msg}"`,
      { stdio: 'inherit', cwd: ROOT, shell: true }
    );
  } catch (_) {}

  const ok = fvOk && toastOk;
  log(ok ? '=== Morning refresh complete ===' : '=== Morning refresh finished WITH ERRORS ===');
  process.exit(ok ? 0 : 1);
})();
