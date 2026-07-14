/**
 * FourVenues Direct API Forecast Pull
 * Uses Playwright ctx.request.get() so cookies are passed automatically.
 * Calls collected-by-event and sales-number-by-event for upcoming 90 days.
 */

const { chromium } = require("playwright");
const fs = require("fs");

const SESSION_PATH   = "C:\\Cursor\\toast-mcp-server\\fv-final-session.json";
const RESULTS_PATH   = "C:\\Cursor\\toast-mcp-server\\fv-api-results.json";
const DASHBOARD_PATH = "C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html";

const VENUES = [
  { name: "Casa Neos Beach Club", id: "lah0f2isk8qmsg0zapu016rarffvp0xz",  slug: "casa-neos1" },
  { name: "MILA Lounge",          id: "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM",  slug: "mila1" },
  { name: "Casa Neos Lounge",     id: "mrph20a941lojvdykvq598p0b8j3576j",  slug: "casa-neos-lounge" },
];

const APP_HDR = {
  "app-id":         "ajihln7fc0006jhmmi4lh75s2lI9O3jx",
  "device-id":      "Q529vp56m4h2q395ia0i6xt0csuPejE3",
  "storage-bucket": "pro",
  "accept":         "application/json, text/plain, */*",
  "content-type":   "application/json",
  "referer":        "https://pro.fourvenues.com/",
};

function log(msg) { process.stdout.write(`[${new Date().toLocaleTimeString("en-US",{hour12:false})}] ${msg}\n`); }

function dateStr(offsetDays=0) {
  const d = new Date(); d.setDate(d.getDate()+offsetDays);
  return d.toISOString().split("T")[0];
}

(async () => {
  log("=== FourVenues API Forecast Pull ===");

  const sd = JSON.parse(fs.readFileSync(SESSION_PATH));
  const browser = await chromium.launch({
    headless: false,
    args: ["--window-size=1,1","--window-position=-9999,0","--disable-infobars"]
  });
  const ctx = await browser.newContext({ storageState: sd.storageState });
  const page = await ctx.newPage();

  // Warm up session with a quick page visit
  log("Warming up session...");
  await page.goto("https://pro.fourvenues.com/mila1/reports/dashboard-sales",
    { waitUntil:"domcontentloaded", timeout:20000 }).catch(()=>{});
  await page.waitForTimeout(4000);

  // Capture session/user headers from live page requests
  let sessionId = sd.sessionId||"", userId = sd.userId||"";
  page.on("request", r => {
    if (!r.url().includes("api.fourvenues.com")) return;
    const h = r.headers();
    if (h["session-id"] && !sessionId) sessionId = h["session-id"];
    if (h["user-id"]    && !userId)    userId    = h["user-id"];
  });
  await page.waitForTimeout(2000);

  const dateFrom  = dateStr(0);
  const dateUntil = dateStr(90) + " 23:59:59";
  const where     = { date_from:dateFrom, date_until:dateUntil, timezone:"America/New_York", modeGgdd:false, modeFeesTaxes:false, pagination:{page:0,pageSize:50} };
  const whereEnc  = encodeURIComponent(JSON.stringify(where));

  const allResults = {};

  for (const v of VENUES) {
    log(`\n── ${v.name} ──`);
    const base = `https://api.fourvenues.com/reports/sales/organization/${v.id}`;

    // Ensure session headers are included
    const hdrs = { ...APP_HDR };
    if (sessionId) hdrs["session-id"] = sessionId;
    if (userId)    hdrs["user-id"]    = userId;

    // sales-number-by-event: how many tickets/tables sold per event
    const salesR = await ctx.request.get(`${base}/sales-number-by-event?where=${whereEnc}&options={}`, { headers: hdrs });
    let salesData = null;
    try { salesData = await salesR.json(); } catch(e){}

    // collected-by-event: revenue collected per event
    const collR = await ctx.request.get(`${base}/collected-by-event?where=${whereEnc}&options={}`, { headers: hdrs });
    let collData = null;
    try { collData = await collR.json(); } catch(e){}

    log(`  sales-number-by-event: HTTP ${salesR.status()}`);
    log(`  collected-by-event:    HTTP ${collR.status()}`);

    if (salesData?.data) {
      const rows = Array.isArray(salesData.data) ? salesData.data : [salesData.data];
      log(`  → ${rows.length} event rows in sales data`);
      rows.slice(0,3).forEach(r => log(`    ${JSON.stringify(r).slice(0,200)}`));
    } else {
      log(`  Sales response: ${JSON.stringify(salesData).slice(0,200)}`);
    }

    if (collData?.data) {
      const rows = Array.isArray(collData.data) ? collData.data : [collData.data];
      log(`  → ${rows.length} event rows in collected data`);
      rows.slice(0,3).forEach(r => log(`    ${JSON.stringify(r).slice(0,200)}`));
    } else {
      log(`  Collected response: ${JSON.stringify(collData).slice(0,200)}`);
    }

    allResults[v.name] = { salesData, collData };
  }

  await browser.close();

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(allResults, null, 2));
  log(`\n✅ Results saved to fv-api-results.json`);
})();
