/**
 * Morning refresh — FourVenues + Toast together (~8:30 AM ET).
 * Used by Task Scheduler so both update even if GitHub Actions is delayed.
 *
 * Important: a laptop FV failure must NOT overwrite a successful cloud scrape
 * from the same Miami day (that was wiping green status after 8:25 cloud OK).
 */
'use strict';

const { execSync } = require('child_process');
const https = require('https');
const path = require('path');

const ROOT = __dirname;
const FB_DB = 'rdg-dj-dashboard-default-rtdb.firebaseio.com';

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York' });
  console.log(`[${ts} ET] ${msg}`);
}

function miamiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function fbGet(fbPath) {
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: FB_DB,
      path: fbPath + '.json',
      method: 'GET'
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { res(d ? JSON.parse(d) : null); }
        catch (e) { rej(e); }
      });
    });
    req.on('error', rej);
    req.end();
  });
}

async function cloudFvAlreadyOkToday() {
  try {
    const st = await fbGet('/rdg/scrapeStatus/fourvenues');
    if (!st || st.ok !== true) return false;
    const day = st.miamiDay || (st.at ? String(st.at).slice(0, 10) : null);
    return day === miamiToday();
  } catch (_) {
    return false;
  }
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
    const errMsg = String(e.message || e).split('\n')[0];
    log('ERROR FourVenues: ' + errMsg);
    const preserve = await cloudFvAlreadyOkToday();
    if (preserve) {
      log('Keeping existing OK FourVenues scrapeStatus for ' + miamiToday() + ' (cloud already succeeded)');
    } else {
      try {
        execSync(
          `node "${path.join(ROOT, 'fb-scrape-status.cjs')}" fourvenues fail "Morning FourVenues job failed: ${errMsg.replace(/"/g, '')}"`,
          { stdio: 'inherit', cwd: ROOT, shell: true }
        );
      } catch (_) {}
    }
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
  /* Exit 0 if FV failed but cloud already OK — laptop toast may still have failed. */
  process.exit(ok || (!fvOk && await cloudFvAlreadyOkToday() && toastOk) ? 0 : 1);
})();
