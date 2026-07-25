/**
 * Punctual workflow_dispatch for RDG Daily Forecast + Toast.
 * Prefer trigger-rdg-daily-dispatch.ps1 when on Windows; this is for cron/Node hosts.
 *
 * Env: GH_TOKEN or GITHUB_TOKEN (fine-scoped: actions:write + repo)
 * Usage: node trigger-rdg-daily-dispatch.cjs [both|fourvenues|toast]
 */
'use strict';

const https = require('https');

const JOB = process.argv[2] || 'both';
const REPO = process.env.RDG_DISPATCH_REPO || 'MLavenant/boh-dashboard';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const ALLOWED = new Set(['both', 'fourvenues', 'toast']);

if (!ALLOWED.has(JOB)) {
  console.error('Usage: node trigger-rdg-daily-dispatch.cjs [both|fourvenues|toast]');
  process.exit(1);
}
if (!TOKEN) {
  console.error('Set GH_TOKEN or GITHUB_TOKEN (fine-scoped PAT with actions:write + contents:read).');
  process.exit(1);
}

const body = JSON.stringify({
  ref: 'main',
  inputs: { job: JOB }
});

const req = https.request(
  {
    hostname: 'api.github.com',
    path: `/repos/${REPO}/actions/workflows/rdg-daily.yml/dispatches`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rdg-daily-dispatch',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  },
  (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => {
      if (res.statusCode === 204 || res.statusCode === 200) {
        console.log(`OK workflow_dispatch job=${JOB} → ${REPO} (HTTP ${res.statusCode})`);
        process.exit(0);
      }
      console.error(`FAIL HTTP ${res.statusCode}: ${data || '(empty)'}`);
      process.exit(1);
    });
  }
);
req.on('error', (e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
req.write(body);
req.end();
