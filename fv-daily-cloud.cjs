/**
 * Daily FourVenues Forecast cloud orchestrator (laptop OFF).
 *
 * 1) Trigger Sales Overview → Export to Excel for 3 venues (Playwright)
 * 2) Poll Microsoft Graph mailbox for new Sales Report emails
 * 3) Parse Excel → Firebase forecastLive (via fv-refresh-graph logic)
 *
 * Env secrets:
 *   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, GRAPH_MAILBOX
 *   FV_EMAIL + FV_PASSWORD  (and/or FV_SESSION_B64)
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function runNode(script, extraEnv = {}) {
  log(`→ node ${script}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error(`${script} exited ${r.status}`);
  }
  return r.stdout || '';
}

(async () => {
  log('=== FourVenues daily cloud (trigger → Graph → Firebase) ===');
  const sinceMs = Date.now() - 20000;

  // 1) Trigger exports (emails will arrive in mailbox)
  try {
    runNode('fv-trigger-exports.cjs', { FV_HEADLESS: '1' });
  } catch (e) {
    log('WARNING: export trigger failed: ' + e.message);
    log('Continuing with whatever Sales Report emails are already in the mailbox…');
  }

  // 2) Brief wait so first emails can land
  const waitSec = Number(process.env.FV_EMAIL_WAIT_SEC || 90);
  log(`Waiting ${waitSec}s for Sales Report emails…`);
  await new Promise(r => setTimeout(r, waitSec * 1000));

  // 3) Parse via Graph — prefer emails from this run; fall back to latest in mailbox
  try {
    runNode('fv-refresh-graph.cjs', {
      GRAPH_SINCE_MS: String(sinceMs),
      GRAPH_MAX_AGE_DAYS: process.env.GRAPH_MAX_AGE_DAYS || '14'
    });
  } catch (e) {
    log('No fresh emails matched this run — falling back to latest Sales Reports in mailbox…');
    runNode('fv-refresh-graph.cjs', {
      GRAPH_MAX_AGE_DAYS: process.env.GRAPH_MAX_AGE_DAYS || '14'
    });
  }

  log('=== FourVenues daily cloud complete ===');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
