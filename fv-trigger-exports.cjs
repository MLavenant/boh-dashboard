/**
 * Trigger FourVenues Sales Report emails for all venues (cloud).
 *
 * Auth (first match wins):
 *   1) FV_SESSION_B64 or FV_SESSION_PATH — saved Playwright storageState
 *   2) FV_EMAIL + FV_PASSWORD — Google sign-in to FourVenues
 *
 * Does NOT wait for Outlook. Cloud job polls Microsoft Graph afterward.
 *
 * Usage:
 *   node fv-trigger-exports.cjs
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

async function loginWithGoogle(page, email, password) {
  log('Logging into FourVenues via Google…');
  await page.goto('https://pro.fourvenues.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const googleBtn = page.locator('a[href*="google"], button:has-text("Google"), [class*="google"]').first();
  if (await googleBtn.isVisible().catch(() => false)) {
    await googleBtn.click();
  } else {
    // Sometimes already redirected to id.fourvenues / Google
    log('No Google button on page — continuing at ' + page.url());
  }

  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', email);
  await page.click('button:has-text("Next"), #identifierNext').catch(() =>
    page.locator('#identifierNext').click()
  );
  await page.waitForTimeout(2500);

  await page.waitForSelector('input[type="password"]', { timeout: 30000 });
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Next"), #passwordNext').catch(() =>
    page.locator('#passwordNext').click()
  );

  // Land on pro.fourvenues.com
  const deadline = Date.now() + 90 * 1000;
  while (Date.now() < deadline) {
    const url = page.url();
    if (/pro\.fourvenues\.com\//i.test(url) && !/login|authorization|accounts\.google/i.test(url)) {
      log('Logged in: ' + url.slice(0, 80));
      await dismissPopups(page);
      return;
    }
    // Consent / challenge screens
    const continueBtn = page.getByRole('button', { name: /Continue|Allow|Yes/i }).first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click().catch(() => {});
    }
    await page.waitForTimeout(2000);
  }
  throw new Error('Google login did not reach pro.fourvenues.com — check FV_EMAIL/FV_PASSWORD or 2FA');
}

(async () => {
  const email = String(process.env.FV_EMAIL || '').trim();
  const password = String(process.env.FV_PASSWORD || '').trim();
  const session = loadSessionFromEnv();

  if (!session && !(email && password)) {
    throw new Error('Need FV_EMAIL+FV_PASSWORD or FV_SESSION_B64 / fv-final-session.json to trigger exports');
  }

  const browser = await chromium.launch({
    headless: process.env.FV_HEADLESS !== '0',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,900',
      '--no-sandbox'
    ]
  });

  let ctx;
  if (session) {
    log('Using saved FourVenues session');
    ctx = await browser.newContext({
      storageState: session.storageState || session,
      acceptDownloads: true,
      viewport: { width: 1280, height: 900 }
    });
  } else {
    ctx = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 900 }
    });
  }

  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  if (!session) {
    await loginWithGoogle(page, email, password);
  } else {
    await page.goto('https://pro.fourvenues.com/mila1/reports/sales-overview', {
      waitUntil: 'domcontentloaded', timeout: 45000
    }).catch(() => {});
    await dismissPopups(page);
    await page.waitForTimeout(2000);
    if (/login|authorization|id\.fourvenues/i.test(page.url())) {
      if (email && password) {
        log('Session expired — falling back to Google login');
        await loginWithGoogle(page, email, password);
      } else {
        throw new Error('FV session expired and no FV_EMAIL/FV_PASSWORD to re-login');
      }
    }
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

  if (!ok.length) {
    process.exit(1);
  }
  log(`Triggered ${ok.length}/${VENUES.length} Sales Report emails`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
