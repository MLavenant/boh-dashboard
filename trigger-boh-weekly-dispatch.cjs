/**
 * Punctual workflow_dispatch for BOH Weekly dashboard refresh.
 * Prefer trigger-boh-weekly-dispatch.ps1 on Windows; this is for cron/Node hosts.
 *
 * Env: GH_TOKEN or GITHUB_TOKEN (fine-scoped: actions:write + contents:read)
 * Usage: node trigger-boh-weekly-dispatch.cjs [last|<YYYY-Www>]
 */
'use strict';

const https = require('https');

const WEEK = process.argv[2] || 'last';
const REPO = process.env.RDG_DISPATCH_REPO || 'MLavenant/boh-dashboard';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('Set GH_TOKEN or GITHUB_TOKEN (fine-scoped PAT with actions:write + contents:read).');
  process.exit(1);
}

const body = JSON.stringify({
  ref: 'main',
  inputs: { week: WEEK }
});

const req = https.request(
  {
    hostname: 'api.github.com',
    path: `/repos/${REPO}/actions/workflows/boh-weekly.yml/dispatches`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'boh-weekly-dispatch',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  },
  (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => {
      if (res.statusCode === 204 || res.statusCode === 200) {
        console.log(`OK workflow_dispatch week=${WEEK} → ${REPO} (HTTP ${res.statusCode})`);
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
