/**
 * Morning refresh — Toast only (~8:30 AM ET).
 * FourVenues is not called here. It runs once at 9:30 ET, or when started manually.
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
  log('=== RDG morning refresh (Toast only; FourVenues is 9:30 ET or manual) ===');
  let toastOk = true;

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

  log(toastOk ? '=== Morning refresh complete ===' : '=== Morning refresh finished WITH ERRORS ===');
  process.exit(toastOk ? 0 : 1);
})();
