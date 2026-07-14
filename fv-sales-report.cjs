/**
 * FourVenues Sales Dashboard Scrape
 * Follows the EXACT user-specified flow:
 *   Sales → dashboard-sales → Events → Upcoming → Select All → Export
 *
 * Intercepts the API calls FourVenues makes when the report is loaded
 * to extract per-event, per-category (tier) booking data.
 */

const { chromium } = require("playwright");
const fs = require("fs");

const SESSION_PATH = "C:\\Cursor\\toast-mcp-server\\fv-final-session.json";
const OUT_PATH     = "C:\\Cursor\\toast-mcp-server\\fv-sales-report-data.json";

const VENUES = [
  { name: "Casa Neos Beach Club", slug: "casa-neos1",      id: "lah0f2isk8qmsg0zapu016rarffvp0xz" },
  { name: "MILA Lounge",          slug: "mila1",            id: "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM" },
  { name: "Casa Neos Lounge",     slug: "casa-neos-lounge", id: "mrph20a941lojvdykvq598p0b8j3576j" },
];

function log(msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

(async () => {
  log("=== FourVenues Sales Report Scrape ===");

  const sd = JSON.parse(fs.readFileSync(SESSION_PATH));
  const browser = await chromium.launch({
    headless: false,
    args: ["--window-size=1,1", "--window-position=-9999,0", "--disable-infobars"]
  });
  const ctx = await browser.newContext({
    storageState: sd.storageState,
    acceptDownloads: true   // capture any Excel download
  });
  const page = await ctx.newPage();
  page.on("dialog", d => d.dismiss().catch(() => {}));

  const allData = {};

  for (const v of VENUES) {
    log(`\n── ${v.name} ──`);
    const url = `https://pro.fourvenues.com/${v.slug}/reports/dashboard-sales`;

    // Collect every api.fourvenues.com response for inspection
    const captured = {};
    const onResp = async (r) => {
      const u = r.url();
      if (!u.includes("api.fourvenues.com")) return;
      if (r.status() !== 200) return;
      const body = await r.text().catch(() => "");
      if (body.length > 20) captured[u] = body;
    };
    page.on("response", onResp);

    // 1. Navigate to dashboard-sales
    log(`  Navigating to ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);

    // 2. Click the "Events" filter button
    log("  Clicking Events filter...");
    const eventsBtn = await page.locator("button, [role='button']").filter({ hasText: /^Events/ }).first();
    if (await eventsBtn.isVisible().catch(() => false)) {
      await eventsBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
    } else {
      // Try alternate selector
      await page.click("text=Events").catch(() => {});
      await page.waitForTimeout(2000);
    }

    // 3. Click "Upcoming" tab
    log("  Selecting Upcoming tab...");
    await page.click("text=Upcoming").catch(() => {});
    await page.waitForTimeout(1500);

    // 4. Select All
    log("  Selecting all events...");
    // Try the "Select all" toggle
    const selectAll = await page.locator("text=Select all").first();
    if (await selectAll.isVisible().catch(() => false)) {
      await selectAll.click().catch(() => {});
    } else {
      // Try clicking toggle/checkbox near "Select all"
      await page.locator("[role='switch'], input[type='checkbox']").first().click().catch(() => {});
    }
    await page.waitForTimeout(1500);

    // 5. Click Apply
    log("  Clicking Apply...");
    await page.click("text=Apply").catch(() => {});
    await page.waitForTimeout(4000);  // wait for report data to load

    // 6. Click Breakdown tab to get per-event table data
    log("  Switching to Breakdown tab...");
    await page.click("text=Breakdown").catch(() => {});
    await page.waitForTimeout(3000);

    // 7. Try to trigger Export and capture download
    log("  Attempting export...");
    let downloadedFile = null;
    try {
      const [download] = await Promise.all([
        page.waitForDownload({ timeout: 8000 }),
        page.click("text=Export to Excel").catch(() =>
          page.locator("[aria-label='Export'], button").filter({ hasText: /export/i }).first().click().catch(() => {})
        )
      ]);
      downloadedFile = await download.path();
      log(`  ✅ Downloaded: ${downloadedFile}`);
    } catch (e) {
      log("  ℹ️  No direct download captured (may be email-based export)");
    }

    page.off("response", onResp);

    // Log all captured API endpoints
    const apiKeys = Object.keys(captured);
    log(`  Captured ${apiKeys.length} API responses:`);
    apiKeys.forEach(k => log(`    ${k.replace("https://api.fourvenues.com","")}`));

    // Parse useful endpoints
    const eventsData = [];
    let ticketBreakdown = null;

    for (const [u, body] of Object.entries(captured)) {
      try {
        const j = JSON.parse(body);
        // Look for taquillas (tickets/sales per event) or estadisticas (stats)
        if (u.includes("taquillas") || u.includes("estadisticas") || u.includes("ventas") ||
            u.includes("breakdown") || u.includes("resumen") || u.includes("sales-report")) {
          ticketBreakdown = ticketBreakdown || {};
          ticketBreakdown[u] = j;
          log(`  📊 Found data at: ${u.replace("https://api.fourvenues.com","")}`);
        }
        // Also capture reservation/booking data
        if (u.includes("reservas") || u.includes("reservados")) {
          ticketBreakdown = ticketBreakdown || {};
          ticketBreakdown[u] = j;
        }
      } catch(e) {}
    }

    allData[v.name] = {
      downloadedFile,
      apiEndpoints: Object.keys(captured).map(k => k.replace("https://api.fourvenues.com","")),
      breakdown: ticketBreakdown,
      rawCaptures: captured
    };
  }

  await browser.close();

  // Save full diagnostic output
  // Strip rawCaptures from JSON to keep file size manageable (save separately if needed)
  const summary = {};
  for (const [vname, d] of Object.entries(allData)) {
    summary[vname] = {
      downloadedFile: d.downloadedFile,
      apiEndpoints: d.apiEndpoints,
      breakdownKeys: d.breakdown ? Object.keys(d.breakdown) : [],
      // Save first 2000 chars of each breakdown response
      breakdownSamples: d.breakdown ? Object.fromEntries(
        Object.entries(d.breakdown).map(([k,v]) => [k, JSON.stringify(v).slice(0,2000)])
      ) : {}
    };
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  log(`\n✅ Diagnostic saved to fv-sales-report-data.json`);
  log("Review the output to identify which API endpoints carry the booking data.");
})();
