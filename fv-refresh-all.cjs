/**
 * RDG Dashboard — FourVenues Full Refresh
 * 1) Floor map → table counts / tiers (layout only)
 * 2) SOURCE OF TRUTH: Sales Overview → Upcoming → ⋮ Export → email XLS → Outlook download
 *    Base price (Accepted + Not completed) applied to FORECAST_DATA
 * Fallback only if email export fails: period-window map math (Last 7 days)
 */

const { chromium } = require("playwright");
const fs = require("fs");
const { execSync } = require("child_process");
const { pullSalesExports } = require("./fv-sales-export-lib.cjs");
const { buildForecastFromMaps, summarizeMapData, salesPeriodLast7Days } = require("./fv-sales-period.cjs");

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

/** Theme modal: choose Dark, then Accept (blocks scraping if left open). */
async function dismissPopups(page) {
  try {
    const darkModal = page.getByText(/New dark mode available|dark mode available/i).first();
    if (await darkModal.isVisible({ timeout: 1200 }).catch(() => false)) {
      log("  Theme modal → choosing Dark…");
      const darkBySub = page.getByText(/Interface in dark tones/i).first();
      if (await darkBySub.isVisible().catch(() => false)) {
        await darkBySub.click({ timeout: 2000 }).catch(() => {});
      } else {
        const darkCard = page.locator("label, [role='radio'], button, div").filter({ hasText: /^Dark$/i }).first();
        if (await darkCard.isVisible().catch(() => false)) {
          await darkCard.click({ timeout: 2000 }).catch(() => {});
        } else {
          await page.getByText(/^Dark$/i).first().click({ timeout: 2000 }).catch(() => {});
        }
      }
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /^Accept$/i }).click({ timeout: 3000 }).catch(() =>
        page.getByText(/^Accept$/i).first().click().catch(() => {})
      );
      await page.waitForTimeout(800);
      return;
    }
  } catch (_) {}

  await page.getByRole("button", { name: /^Accept$/i }).click({ timeout: 1500 }).catch(() =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll("label, [role='radio'], button, div")];
      const dark = cards.find(el => /^Dark$/i.test(((el.textContent || "").trim().split("\n")[0]) || ""));
      if (dark) dark.click();
      for (const b of document.querySelectorAll("button")) {
        const t = (b.textContent || "").trim();
        if (/^Accept$/i.test(t) || /^Aceptar$/i.test(t)) { b.click(); break; }
      }
    }).catch(() => {})
  );
}

async function scrapeEventBookings(page, slug, eventId) {
  const bookingUrl = `https://pro.fourvenues.com/${slug}/${eventId}/sales/bookings`;

  async function captureOnce() {
    const captured = {};
    const captureHandler = async (r) => {
      const u = r.url();
      if (!u.includes("api.fourvenues.com") || r.status() !== 200) return;
      if (u.includes("listado_reservados_mapa") || u.includes("reservados_mapa") ||
          u.includes("listado_bookings_kpis") || u.includes("bookings_kpis")) {
        const body = await r.text().catch(() => "");
        if (body.length > 10) captured[u] = body;
      }
    };
    page.on("response", captureHandler);
    await page.goto(bookingUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    await dismissPopups(page);
    await page.waitForTimeout(4500);
    page.off("response", captureHandler);
    return captured;
  }

  let captured = await captureOnce();
  let hasListado = Object.keys(captured).some(u => u.includes("listado_reservados_mapa"));
  for (let attempt = 0; !hasListado && attempt < 2; attempt++) {
    const retryHandler = async (r) => {
      const u = r.url();
      if (u.includes("listado_reservados_mapa") && r.status() === 200) {
        const body = await r.text().catch(() => "");
        if (body.length > 10) captured[u] = body;
      }
    };
    page.on("response", retryHandler);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(5000);
    page.off("response", retryHandler);
    hasListado = Object.keys(captured).some(u => u.includes("listado_reservados_mapa"));
  }
  if (!hasListado) {
    captured = await captureOnce();
  }

  let mapData = null, kpiData = null;
  for (const [url, body] of Object.entries(captured)) {
    try {
      if (url.includes("listado_reservados_mapa")) mapData = JSON.parse(body);
      else if (!mapData && url.includes("reservados_mapa")) mapData = JSON.parse(body);
      if (url.includes("listado_bookings_kpis") || url.includes("bookings_kpis")) kpiData = JSON.parse(body);
    } catch (e) {}
  }
  return { mapData, kpiData };
}

function _fvCountableStatus(estado) {
  // Sales-report style: Accepted OR Not completed (exclude cancelled / completed / rejected / invites)
  const e = String(estado || "").toLowerCase().trim().replace(/_/g, "-");
  if (!e) return false;
  if (e === "aceptada" || e === "accepted") return true;
  if (e === "no-completada" || e === "no completada" || e === "not-completed" || e === "not completed") return true;
  return false;
}

// summarizeMapData / salesPeriodLast7Days imported from fv-sales-period.cjs

/** Overlay Sales-export Base price totals onto Forecast rows (venue+date+DJ). */
function applySalesExportOverlay(results, forecastRows) {
  const byKey = new Map();
  for (const r of forecastRows) {
    if (!r.date || !r.venue) continue;
    byKey.set(`${r.venue}|${r.date}|${String(r.dj || "").toUpperCase()}`, r);
    const vd = `${r.venue}|${r.date}`;
    if (!byKey.has(vd)) byKey.set(vd, r);
    else byKey.set(vd + "|#multi", true);
  }
  let hit = 0;
  for (const e of results) {
    const djKey = `${e.venue}|${e.date}|${String(e.dj || "").toUpperCase()}`;
    let row = byKey.get(djKey);
    if (!row && !byKey.get(`${e.venue}|${e.date}|#multi`)) row = byKey.get(`${e.venue}|${e.date}`);
    if (!row) continue;
    e.totalRevenue = row.totalRevenue;
    if (row.bookings != null) e.bookedTables = row.bookings;
    e.hasData = true;
    e._source = "sales_export";
    if (e.tierSummary && typeof e.tierSummary === "object") {
      for (const t of Object.keys(e.tierSummary)) {
        if (e.tierSummary[t] && typeof e.tierSummary[t] === "object") e.tierSummary[t].revenue = 0;
      }
    }
    hit++;
  }
  return hit;
}

/** Zero revenue before export overlay — map is layout only until email XLS lands. */
function zeroForecastRevenue(results) {
  for (const e of results) {
    e.totalRevenue = 0;
    e._source = undefined;
    if (e.tierSummary && typeof e.tierSummary === "object") {
      for (const t of Object.keys(e.tierSummary)) {
        if (e.tierSummary[t] && typeof e.tierSummary[t] === "object") e.tierSummary[t].revenue = 0;
      }
    }
  }
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
  await dismissPopups(page);
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
      const { mapData, kpiData } = await scrapeEventBookings(page, v.slug, evt._id);
      const summary = mapData ? summarizeMapData(mapData, salesPeriodLast7Days()) : null;
      const icon = mapData ? "✅" : "⚪";
      const tbl = summary ? ` ${summary.bookedTables}/${summary.totalTables} tables` : "";
      log(`  ${icon} ${evDate} ${evt.nombre}${tbl}`);
      eventsData.push({ date: evDate, name: evt.nombre, id: evt._id, mapData, kpiData });
    }
    allData[v.name] = eventsData;
  }

  await browser.close();
  log("\nBrowser closed. Building forecast data...");

  // Save raw booking data
  fs.writeFileSync(DATA_PATH, JSON.stringify(allData, null, 2));

  // Skeleton from maps (tables/layout). Revenue filled by real Sales email export next.
  let { results, period } = buildForecastFromMaps(allData);
  zeroForecastRevenue(results);
  log(`Map layout ready (${results.length} events). Period window kept as fallback: ${period.date_from} → ${period.date_until}`);

  // SOURCE OF TRUTH: Overview → Upcoming → ⋮ Export → email → Outlook → XLS
  log("\n=== Pulling FourVenues Sales Excel via email (Outlook) ===");
  let exportOk = false;
  try {
    const pulled = await pullSalesExports({ venue: "all", headless: false });
    const n = applySalesExportOverlay(results, pulled.forecastRows);
    exportOk = pulled.forecastRows.length > 0;
    log(`Sales email export: ${pulled.forecastRows.length} event totals, ${n}/${results.length} Forecast rows matched`);
    pulled.forecastRows.forEach(r =>
      log(`  📧 ${r.venue} | ${r.date} | ${r.dj} | $${Number(r.totalRevenue).toLocaleString()} (export)`)
    );
    (pulled.results || []).filter(r => r.error).forEach(r =>
      log(`  ⚠️ Export error ${r.venue}: ${r.error}`)
    );
  } catch (e) {
    log("ERROR Sales email export failed: " + e.message);
  }

  if (!exportOk) {
    log("⚠️ Falling back to period-window map math (Last 7 days) — email export returned no rows");
    const fb = buildForecastFromMaps(allData);
    results = fb.results;
    period = fb.period;
    results.filter(r => r.totalRevenue > 0).forEach(r =>
      log(`  📊 ${r.venue} | ${r.date} | ${r.dj} | $${r.totalRevenue.toLocaleString()} (fallback period math)`)
    );
  }

  // Generate JS
  const newDataJS = "var FORECAST_DATA = [\n" +
    results.map(r => "  " + JSON.stringify(r)).join(",\n") +
    "\n];";

  // Replace ONLY the FORECAST_DATA array (bracket-balanced) — never touch JS below it.
  // A naive /[\s\S]*?\n];/ regex previously swallowed renderForecast + HELP_FAQ.
  const htmlRaw = fs.readFileSync(DASHBOARD_PATH, "latin1");
  const startToken = "var FORECAST_DATA = [";
  const start = htmlRaw.indexOf(startToken);
  if (start < 0) {
    log("ERROR: Could not find FORECAST_DATA in index.html");
    process.exit(1);
  }
  let depth = 0;
  let end = -1;
  for (let i = start + startToken.length - 1; i < htmlRaw.length; i++) {
    const ch = htmlRaw[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        // include trailing semicolon if present
        end = htmlRaw[i + 1] === ";" ? i + 2 : i + 1;
        break;
      }
    }
  }
  if (end < 0) {
    log("ERROR: Could not find end of FORECAST_DATA array");
    process.exit(1);
  }
  const htmlNew = htmlRaw.slice(0, start) + newDataJS + htmlRaw.slice(end);
  fs.writeFileSync(DASHBOARD_PATH, htmlNew, "latin1");
  log(`Updated index.html — ${results.length} events, ${results.filter(r => r.totalRevenue > 0).length} with bookings (source=${exportOk ? "sales_export_email" : "period_fallback"})`);

  // Git commit and push
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  try {
    execSync(`cd "${DASHBOARD_PATH.replace("index.html","")}" && git add -A && git commit -m "Auto-refresh: FourVenues forecast data — ${today}" && git push origin main`, { stdio: "inherit", shell: "cmd.exe" });
    log("✅ Pushed to GitHub successfully");
  } catch (e) {
    log("Git push error: " + e.message);
  }

  log("\n=== FourVenues Refresh Complete ===");
  const booked = results.filter(r => r.totalRevenue > 0);
  booked.forEach(r => log(`  ${r.venue} | ${r.date} | ${r.dj} | $${r.totalRevenue.toLocaleString()} committed`));

  // --- Write pacing snapshots to Firebase ---
  log("\n--- Writing pacing snapshots to Firebase ---");
  try {
    const https2 = require("https");
    const FB_DB   = "rdg-dj-dashboard-default-rtdb.firebaseio.com";
    const today2  = new Date().toISOString().split("T")[0];

    function fbPut(path, payload) {
      return new Promise((res, rej) => {
        const body = JSON.stringify(payload);
        const req = https2.request({
          hostname: FB_DB, path: path + ".json", method: "PUT",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
        }, r => { let d=""; r.on("data",c=>d+=c); r.on("end",()=>res(r.statusCode)); });
        req.on("error", rej); req.write(body); req.end();
      });
    }

    for (const r of results) {
      // Key: venue_YYYY-MM-DD  (spaces→underscore, special chars stripped)
      const key = (r.venue + "_" + r.date).replace(/[^a-zA-Z0-9_-]/g, "_");
      const status = await fbPut(`/rdg/pacing/${key}/${today2}`, {
        tables: r.bookedTables,
        revenue: Math.round(r.totalRevenue),
        source: r._source || (exportOk ? "sales_export" : "period_fallback")
      });
      log(`  ${r.venue} ${r.date} → HTTP ${status}`);
    }
    log("✅ Pacing snapshots written");
  } catch(e) {
    log("Pacing write error: " + e.message);
  }

  // Enrich performance DB with D-n pace from today's map reservations (created_at)
  try {
    log("\n--- Updating FV performance DB ---");
    const { buildPerfRecord } = require("./fv-perf-lib.cjs");
    const cachePath = __dirname + "\\fv-perf-scrape-cache.json";
    let cache = { events: [], doneIds: {} };
    if (fs.existsSync(cachePath)) {
      try { cache = JSON.parse(fs.readFileSync(cachePath, "utf8")); } catch (e) {}
    }
    cache.events = cache.events || [];
    cache.doneIds = cache.doneIds || {};
    const byId = new Map(cache.events.map((e, i) => [e.id, i]));
    for (const venueName of VENUE_ORDER) {
      for (const e of (allData[venueName] || [])) {
        if (!e.mapData || !e.id) continue;
        const rec = buildPerfRecord({
          venue: venueName, date: e.date, dj: e.name, fee: null,
          finalBs: null, finalSrc: null, mapData: e.mapData, eventId: e.id
        });
        const row = {
          venue: rec.venue, date: rec.date, dj: rec.dj, id: rec.eventId,
          finalBs: null, finalSrc: null, fee: null,
          d14Rev: rec.d14Rev, d7Rev: rec.d7Rev, d4Rev: rec.d4Rev, d1Rev: rec.d1Rev, d0Rev: rec.d0Rev,
          tablesD4: rec.tablesD4, tablesFinal: rec.tablesFinal, multD4: null,
          scrapedAt: rec.scrapedAt, hasMap: true
        };
        if (byId.has(e.id)) cache.events[byId.get(e.id)] = Object.assign({}, cache.events[byId.get(e.id)], row);
        else { cache.events.push(row); byId.set(e.id, cache.events.length - 1); }
        cache.doneIds[e.id] = true;
      }
    }
    fs.writeFileSync(cachePath, JSON.stringify(cache));
    execSync(`node "${__dirname}\\fv-build-perf-db.cjs"`, { stdio: "inherit", shell: "cmd.exe", cwd: __dirname });
    log("✅ Performance DB updated");
  } catch (e) {
    log("Perf DB note: " + (e.message || "").split("\n")[0]);
  }

  // Toast is Monday-only — do NOT run it from the daily FourVenues job
  const bookedCount = results.filter(r => r.totalRevenue > 0).length;
  try {
    execSync(
      `node "C:\\Cursor\\toast-mcp-server\\fb-scrape-status.cjs" fourvenues ok "Scraped ${results.length} events, ${bookedCount} with bookings"`,
      { stdio: "inherit", shell: "cmd.exe" }
    );
  } catch (e) {
    log("Status write error: " + e.message.split("\n")[0]);
  }

  // Toast BS Actual: daily for operating nights (MILA Wed–Sat, Lounge Thu–Sun, Beach Sat–Sun)
  try {
    log("\n--- Daily Toast BS Actual ---");
    execSync(`node "${__dirname}\\toast-bs-update.cjs"`, { stdio: "inherit", shell: "cmd.exe", cwd: __dirname });
  } catch (e) {
    log("Toast BS note: " + (e.message || "").split("\n")[0]);
  }

  log("\n=== FourVenues Refresh Complete (Toast BS runs daily after FV) ===");
})();
