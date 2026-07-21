/**
 * Trigger FourVenues Sales Report emails for all venues (cloud).
 *
 * Auth: FV_SESSION_B64 or fv-final-session.json (Playwright storageState).
 * Google headless login is NOT used on CI — Google blocks it. Refresh session locally instead.
 *
 * Does NOT wait for Outlook. Cloud job polls Microsoft Graph afterward.
 *
 * Refresh session (on your PC, once when expired):
 *   node fv-relogin-save.cjs
 *   then update GitHub secret FV_SESSION_B64 (or use set-fv-secret.ps1)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');
const {
  VENUES,
  triggerVenueExportEmail,
  dismissPopups
} = require('./fv-sales-export-lib.cjs');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadSessionFromEnv() {
  if (process.env.FV_SESSION_B64) {
    const buf = Buffer.from(String(process.env.FV_SESSION_B64).replace(/\s+/g, ''), 'base64');
    let raw = buf;
    if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      raw = zlib.gunzipSync(buf);
    }
    return JSON.parse(raw.toString('utf8'));
  }
  const p = process.env.FV_SESSION_PATH || path.join(__dirname, 'fv-final-session.json');
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null;
}

(async () => {
  const session = loadSessionFromEnv();
  if (!session) {
    throw new Error(
      'Missing FV_SESSION_B64 (or fv-final-session.json). ' +
      'On your PC run: node fv-relogin-save.cjs  then set GitHub secret FV_SESSION_B64. ' +
      'Google login is not used in cloud (blocked on Actions).'
    );
  }

  const browser = await chromium.launch({
    headless: process.env.FV_HEADLESS !== '0',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,900',
      '--no-sandbox'
    ]
  });

  log('Using saved FourVenues session');
  const ctx = await browser.newContext({
    storageState: session.storageState || session,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 }
  });

  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto('https://pro.fourvenues.com/mila1/reports/sales-overview', {
    waitUntil: 'domcontentloaded', timeout: 45000
  }).catch(() => {});
  await dismissPopups(page);
  await page.waitForTimeout(2000);

  if (/login|authorization|id\.fourvenues/i.test(page.url())) {
    await browser.close();
    throw new Error(
      'FV session expired (redirected to login). ' +
      'On your PC: node fv-relogin-save.cjs → update GitHub secret FV_SESSION_B64 → re-run workflow.'
    );
  }

  const startedAt = Date.now();
  const results = [];
  for (const v of VENUES) {
    try {
      results.push(await triggerVenueExportEmail(page, v));
    } catch (e) {
      log(`ERROR ${v.name}: ${e.message}`);
      results.push({ venue: v.name, venueKey: v.key, venueId: v.id, error: e.message });
    }
  }

  await browser.close();

  const ok = results.filter(r => !r.error);
  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    sinceMs: startedAt - 15000,
    triggered: ok.length,
    total: VENUES.length,
    results
  };
  const outPath = path.join(__dirname, 'fv-exports', 'trigger-summary.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));

  if (!ok.length) process.exit(1);
  log(`Triggered ${ok.length}/${VENUES.length} Sales Report emails`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
