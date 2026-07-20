/**
 * Interactive FourVenues login → saves fv-final-session.json
 * A Chromium window opens. Log in with Google, then leave it until this script finishes.
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'fv-final-session.json');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1280,900']
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  console.log('');
  console.log('=================================================');
  console.log('  A browser window opened.');
  console.log('  1) Log in to FourVenues (Google is fine)');
  console.log('  2) Wait until you see the MILA sales dashboard');
  console.log('  3) Do not close the window — this script will');
  console.log('=================================================');
  console.log('');

  await page.goto('https://pro.fourvenues.com/mila1/reports/sales-overview', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  }).catch(() => {});

  // Wait until we are clearly authenticated on pro.fourvenues.com
  const deadline = Date.now() + 5 * 60 * 1000;
  let ok = false;
  while (Date.now() < deadline) {
    const url = page.url();
    const onPro = /pro\.fourvenues\.com\//i.test(url);
    const onAuth = /id\.fourvenues\.com|\/login|\/authorization/i.test(url);
    let hasSessionCookie = false;
    try {
      const cookies = await ctx.cookies();
      hasSessionCookie = cookies.some(c =>
        /session|token|auth|jwt|fv_/i.test(c.name) ||
        (c.domain.includes('fourvenues') && c.value.length > 40 && !/^GA|AMP|_|cf_|hj/i.test(c.name))
      );
    } catch (_) {}

    // Also treat "sales-overview loaded with nav chrome" as success via API
    let apiAuthed = false;
    try {
      const r = await page.evaluate(async () => {
        try {
          const res = await fetch('https://api.fourvenues.com/sesiones/', { credentials: 'include' });
          const t = await res.text();
          return { status: res.status, body: t.slice(0, 200) };
        } catch (e) {
          return { status: 0, body: String(e) };
        }
      });
      if (r.status === 200 && /true|"data"|usuario|user/i.test(r.body) && !/false|"error"/i.test(r.body)) {
        apiAuthed = true;
      }
      process.stdout.write(`\rURL: ${url.slice(0, 70).padEnd(70)} authAPI=${apiAuthed} cookies=${hasSessionCookie}   `);
      if (onPro && !onAuth && (apiAuthed || hasSessionCookie)) {
        ok = true;
        break;
      }
    } catch (_) {}

    await page.waitForTimeout(2000);
  }
  console.log('');

  if (!ok) {
    console.error('Timed out waiting for login. Close the window and re-run.');
    await browser.close().catch(() => {});
    process.exit(1);
  }

  // Warm a bookings page so storage has full auth
  await page.goto('https://pro.fourvenues.com/casa-neos1/bhv61fopi0au52egpi7pmnoqnsprawkh/sales/bookings', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  }).catch(() => {});
  await page.waitForTimeout(4000);

  if (/id\.fourvenues\.com|authorization|login/i.test(page.url())) {
    console.error('Still redirected to login on bookings page. Login incomplete — try again.');
    await browser.close().catch(() => {});
    process.exit(1);
  }

  const allCookies = await ctx.cookies();
  const state = await ctx.storageState();
  fs.writeFileSync(OUT, JSON.stringify({ storageState: state, allCookies }, null, 2));
  console.log('✅ Saved session →', OUT);
  console.log('   cookies:', allCookies.length, '| domains:', [...new Set(allCookies.map(c => c.domain))].join(', '));
  console.log('   You can close the browser window now.');
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
