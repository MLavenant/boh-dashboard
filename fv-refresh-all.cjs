/**
 * RDG Dashboard — FourVenues Full Refresh
 * Scrapes all 3 venues, rebuilds FORECAST_DATA in index.html, commits & pushes.
 * Run manually or via Task Scheduler (nightly).
 */

const { chromium } = require("playwright");
const fs = require("fs");
const { execSync } = require("child_process");

const DASHBOARD_PATH = "C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html";
const SESSION_PATH   = "C:\\Cursor\\toast-mcp-server\\fv-final-session.json";
const DATA_PATH      = "C:\\Cursor\\toast-mcp-server\\fv-bookings-data.json";

const APP_HDR = {
  "storage-bucket": "pro",
  "referer": "https://pro.fourvenues.com/",
  "device-id": "Q529vp56m4h2q395ia0i6xt0csuPejE3",
  "accept": "application/json, text/plain, */*",
  "content-type": "application/json",
  "app-id": "ajihln7fc0006jhmmi4lh75s2lI9O3jx",
};

const VENUES = [
  { name: "Casa Neos Beach Club", id: "lah0f2isk8qmsg0zapu016rarffvp0xz",  slug: "casa-neos1" },
  { name: "MILA Lounge",          id: "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM",  slug: "mila1" },
  { name: "Casa Neos Lounge",     id: "mrph20a941lojvdykvq598p0b8j3576j",  slug: "casa-neos-lounge" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function summarizeMapData(mapData) {
  const zones = Array.isArray(mapData.data) ? mapData.data : [mapData.data];
  let totalTables = 0, bookedTables = 0, totalRevenue = 0;
  const tierSummary = {};
  for (const z of zones) {
    const tipos = {};
    (z.tipos || []).forEach(t => { tipos[t.slug] = t.nombre; });
    for (const esp of (z.espacios || [])) {
      if (esp.bloqueado) continue;
      totalTables++;
      const tier = esp.tipos_slugs?.[0] ? (tipos[esp.tipos_slugs[0]] || "Other") : "Other";
      if (!tierSummary[tier]) tierSummary[tier] = { total: 0, booked: 0, revenue: 0 };
      tierSummary[tier].total++;
      if (esp.ocupado) { bookedTables++; tierSummary[tier].booked++; }
    }
    for (const res of (z.reservas || [])) {
      if (res.estado !== "aceptada") continue;
      const tier = res.tipo_slug ? (tipos[res.tipo_slug] || "Other") : "Other";
      const rev = res.precio || 0;
      totalRevenue += rev;
      if (tierSummary[tier]) tierSummary[tier].revenue += rev;
    }
  }
  return { totalTables, bookedTables, totalRevenue, tierSummary };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  log("=== RDG Forecast Refresh Starting ===");

  // Launch browser
  // Must use non-headless to pass Cloudflare on FourVenues booking pages
  const browser = await chromium.launch({
    headless: false,
    args: ["--window-size=1,1", "--window-position=-9999,0", "--disable-infobars"]
  });
  const sd = JSON.parse(fs.readFileSync(SESSION_PATH));
  const ctx = await browser.newContext({ storageState: sd.storageState });
  const page = await ctx.newPage();

  // Dismiss any popups automatically
  page.on("dialog", d => d.dismiss().catch(() => {}));
  page.on("response", async r => {
    // Auto-click dark mode / cookie popups if they appear
  });

  // Warm up session
  log("Warming up session...");
  await page.goto("https://pro.fourvenues.com/mila1/reports/sales-overview", {
    waitUntil: "domcontentloaded", timeout: 30000
  }).catch(() => {});
  await page.waitForTimeout(3000);

  const todaySec = Math.floor(Date.now() / 1000);
  const allData = {};

  for (const v of VENUES) {
    log(`\nScraping ${v.name}...`);

    // Get upcoming events
    const evQ = JSON.stringify({ negocio_id: v.id, eliminado: 0, cancelado: 0, fecha: { "$gte": todaySec - 86400 } });
    const evR = await ctx.request.get(
      "https://api.fourvenues.com/eventos/?query=" + encodeURIComponent(evQ) +
      "&options=" + encodeURIComponent(JSON.stringify({ limit: 50, sort: { fecha: 1 } })),
      { headers: APP_HDR }
    );
    let events = [];
    try { events = (await evR.json()).data || []; } catch (e) {}
    log(`  ${events.length} events found`);

    const eventsData = [];
    for (const evt of events) {
      const evDate = new Date(evt.fecha * 1000).toISOString().split("T")[0];

      // Navigate to event booking page and capture map data
      const captured = {};
      const captureHandler = async (r) => {
        const u = r.url();
        if (u.includes("api.fourvenues.com") && r.status() === 200 &&
            (u.includes("reservados_mapa") || u.includes("bookings_kpis"))) {
          const body = await r.text().catch(() => "");
          if (body.length > 10) captured[u] = body;
        }
      };
      page.on("response", captureHandler);
      await page.goto(
        `https://pro.fourvenues.com/${v.slug}/${evt._id}/sales/bookings`,
        { waitUntil: "domcontentloaded", timeout: 20000 }
      ).catch(() => {});

      // Dismiss any popup that appears
      await page.evaluate(() => {
        const btns = document.querySelectorAll("button");
        btns.forEach(b => { if (b.textContent.includes("Accept") || b.textContent.includes("Aceptar")) b.click(); });
      }).catch(() => {});

      await page.waitForTimeout(3000);
      page.off("response", captureHandler);

      let mapData = null, kpiData = null;
      for (const [url, body] of Object.entries(captured)) {
        try {
          if (url.includes("reservados_mapa")) mapData = JSON.parse(body);
          if (url.includes("bookings_kpis")) kpiData = JSON.parse(body);
        } catch (e) {}
      }

      const icon = (mapData || kpiData) ? "✅" : "⚪";
      log(`  ${icon} ${evDate} ${evt.nombre}`);
      eventsData.push({ date: evDate, name: evt.nombre, id: evt._id, mapData, kpiData });
    }
    allData[v.name] = eventsData;
  }

  await browser.close();
  log("\nBrowser closed. Building forecast data...");

  // Save raw booking data
  fs.writeFileSync(DATA_PATH, JSON.stringify(allData, null, 2));

  // Build FORECAST_DATA entries
  const VENUE_ORDER = ["Casa Neos Beach Club", "MILA Lounge", "Casa Neos Lounge"];
  const results = [];

  for (const venueName of VENUE_ORDER) {
    const events = allData[venueName] || [];
    for (const e of events) {
      const summary = e.mapData ? summarizeMapData(e.mapData) : { totalTables: 0, bookedTables: 0, totalRevenue: 0, tierSummary: {} };
      results.push({
        venue: venueName,
        date: e.date,
        dj: e.name,
        bookedTables: summary.bookedTables,
        totalTables: summary.totalTables,
        totalRevenue: summary.totalRevenue,
        tierSummary: summary.tierSummary,
        hasData: !!e.mapData
      });
    }
  }

  // Generate JS
  const newDataJS = "var FORECAST_DATA = [\n" +
    results.map(r => "  " + JSON.stringify(r)).join(",\n") +
    "\n];";

  // Read HTML and replace FORECAST_DATA block
  const htmlRaw = fs.readFileSync(DASHBOARD_PATH, "latin1");
  const pattern = /var FORECAST_DATA = \[[\s\S]*?\n\];/;
  const match = htmlRaw.match(pattern);
  if (!match) {
    log("ERROR: Could not find FORECAST_DATA in index.html");
    process.exit(1);
  }
  const htmlNew = htmlRaw.replace(pattern, newDataJS);
  fs.writeFileSync(DASHBOARD_PATH, htmlNew, "latin1");
  log(`Updated index.html — ${results.length} events, ${results.filter(r => r.totalRevenue > 0).length} with bookings`);

  // Git commit and push
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  try {
    execSync(`cd "${DASHBOARD_PATH.replace("index.html","")}" && git add -A && git commit -m "Auto-refresh: FourVenues forecast data — ${today}" && git push origin main`, { stdio: "inherit", shell: "cmd.exe" });
    log("✅ Pushed to GitHub successfully");
  } catch (e) {
    log("Git push error: " + e.message);
  }

  log("\n=== Refresh Complete ===");
  const booked = results.filter(r => r.totalRevenue > 0);
  booked.forEach(r => log(`  ${r.venue} | ${r.date} | ${r.dj} | $${r.totalRevenue.toLocaleString()} committed`));
})();
