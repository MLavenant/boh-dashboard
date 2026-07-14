/**
 * FourVenues Forecast — in-page fetch for upcoming events
 * Navigate to the dashboard, then use page.evaluate() so fetch()
 * runs inside the browser with all cookies, bypassing CORS/auth.
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const SESSION_PATH   = "C:\\Cursor\\toast-mcp-server\\fv-final-session.json";
const RESULTS_PATH   = "C:\\Cursor\\toast-mcp-server\\fv-api-results.json";
const DASHBOARD_PATH = "C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html";

const VENUES = [
  { name: "Casa Neos Beach Club", id: "lah0f2isk8qmsg0zapu016rarffvp0xz",  slug: "casa-neos1" },
  { name: "MILA Lounge",          id: "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM",  slug: "mila1" },
  { name: "Casa Neos Lounge",     id: "mrph20a941lojvdykvq598p0b8j3576j",  slug: "casa-neos-lounge" },
];

function log(msg) { process.stdout.write(`[${new Date().toLocaleTimeString("en-US",{hour12:false})}] ${msg}\n`); }

function dateStr(offsetDays=0) {
  const d = new Date(); d.setDate(d.getDate()+offsetDays);
  return d.toISOString().split("T")[0];
}

(async () => {
  log("=== FourVenues Forecast API ===");

  const sd = JSON.parse(fs.readFileSync(SESSION_PATH));
  const browser = await chromium.launch({
    headless: false,
    args: ["--window-size=800,600","--window-position=0,0","--disable-infobars"]
  });
  const ctx = await browser.newContext({ storageState: sd.storageState });
  const page = await ctx.newPage();
  page.on("dialog", d => d.dismiss().catch(()=>{}));

  // Warm up on a venue page to ensure session cookies are live
  log("Warming up session...");
  await page.goto("https://pro.fourvenues.com/mila1/reports/dashboard-sales",
    { waitUntil:"domcontentloaded", timeout:25000 }).catch(()=>{});
  await page.waitForTimeout(4000);
  log("Session ready.");

  const dateFrom  = dateStr(0);
  const dateUntil = dateStr(90) + " 23:59:59";
  const tz        = "America/New_York";

  const allResults = {};

  for (const v of VENUES) {
    log(`\n── ${v.name} ──`);

    // Navigate to this venue's sales page (ensures cookies for that org)
    await page.goto(`https://pro.fourvenues.com/${v.slug}/reports/dashboard-sales`,
      { waitUntil:"domcontentloaded", timeout:20000 }).catch(()=>{});
    await page.waitForTimeout(3000);

    // Use page.evaluate so fetch() runs in browser context with all cookies
    const result = await page.evaluate(async ({ venueId, dateFrom, dateUntil, tz }) => {
      const base = `https://api.fourvenues.com/reports/sales/organization/${venueId}`;

      const where = {
        date_from: dateFrom,
        date_until: dateUntil,
        timezone: tz,
        modeGgdd: false,
        modeFeesTaxes: false,
        pagination: { page: 0, pageSize: 50 }
      };
      const q = encodeURIComponent(JSON.stringify(where));

      // Get headers from a page script tag if available
      let sessionId = "", userId = "";
      try {
        const sesR = await fetch(`https://api.fourvenues.com/sesion/?query={}&options={"disableCache":true}`, { credentials: "include" });
        const sesJ = await sesR.json();
        // session-id is in the request headers, not response — capture from meta or store
      } catch(e) {}

      const [salesR, collR] = await Promise.all([
        fetch(`${base}/sales-number-by-event?where=${q}&options={}`, { credentials: "include" }),
        fetch(`${base}/collected-by-event?where=${q}&options={}`, { credentials: "include" })
      ]);

      const [salesStatus, collStatus] = [salesR.status, collR.status];
      const [salesJson, collJson] = await Promise.all([salesR.json().catch(()=>null), collR.json().catch(()=>null)]);

      return { salesStatus, collStatus, salesJson, collJson };
    }, { venueId: v.id, dateFrom, dateUntil, tz });

    log(`  sales-number-by-event: HTTP ${result.salesStatus}`);
    log(`  collected-by-event:    HTTP ${result.collStatus}`);

    if (result.salesStatus === 200 && result.salesJson?.data) {
      const rows = Array.isArray(result.salesJson.data) ? result.salesJson.data : [result.salesJson.data];
      log(`  → ${rows.length} events in sales data`);
      rows.slice(0,5).forEach(r => log(`    ${JSON.stringify(r).slice(0,250)}`));
    } else {
      log(`  Sales: ${JSON.stringify(result.salesJson).slice(0,200)}`);
    }

    if (result.collStatus === 200 && result.collJson?.data) {
      const rows = Array.isArray(result.collJson.data) ? result.collJson.data : [result.collJson.data];
      log(`  → ${rows.length} events in collected data`);
      rows.slice(0,5).forEach(r => log(`    ${JSON.stringify(r).slice(0,250)}`));
    } else {
      log(`  Collected: ${JSON.stringify(result.collJson).slice(0,200)}`);
    }

    allResults[v.name] = result;
  }

  await browser.close();
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(allResults, null, 2));
  log(`\n✅ Saved to fv-api-results.json`);
})();
