/**
 * Toast LIVE — thin wrapper. Prefer on-demand Live Refresh (live-refresh-http / GitHub Action).
 * Night schedule should be DISABLED (see disable-live-night-task.ps1).
 *
 * Usage: node toast-live-night.cjs [--force]
 */
'use strict';

const { pullToastLive } = require('./toast-live-lib.cjs');

(async () => {
  const force = process.argv.includes('--force');
  const result = await pullToastLive({ force, trigger: force ? 'cli_force' : 'legacy_night_schedule' });
  if (result.skipped) {
    console.log('Skipped:', result.reason);
    process.exit(0);
  }
  process.exit(result.ok ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
