/**
 * weekly-save.js
 * Fetches Toast kitchen timing + OpenTable covers for last week across all venues,
 * saves per-week JSON files, and maintains a rolling 3-week summary.
 *
 * Run: node C:\Cursor\toast-mcp-server\weekly-save.js
 * Scheduled: every Monday at 6am via Windows Task Scheduler
 */

import axios from "axios";
import fs from "fs";
import path from "path";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import dotenv from "dotenv";

const exec = promisify(execCb);

dotenv.config({ path: "C:\\Cursor\\toast-mcp-server\\.env", override: true });

// ── Config ─────────────────────────────────────────────────────────────────

const SESSION_FILE    = "C:\\Cursor\\toast-mcp-server\\toast-session.json";
const OT_SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\ot-session.json";
const DATA_DIR        = "C:\\Cursor\\toast-mcp-server\\data";
const ROLLING_FILE    = path.join(DATA_DIR, "rolling.json");
const TOAST_ADMIN     = "https://www.toasttab.com";

const OT_USERNAME  = "matthias@rivieradininggroup.com";
const OT_PASSWORD  = "MattLondon0401!";
const OT_CLIENT_ID = "0oabit60qvY1wTxAv5d6";

process.env.PLAYWRIGHT_BROWSERS_PATH =
  "C:\\Users\\MatthiasLavenant\\AppData\\Local\\Temp\\cursor-sandbox-cache\\512227bcefb0bd4bdf65a710870dd5b5\\playwright";

const KITCHEN_VENUES = [
  "claudie", "ava_coconut_grove", "ava_winter_park", "mm_ava",
  "casa_neos", "casa_neos_lounge", "mila", "mm_mila",
];

const CUSTOM_REPORT_IDS = {
  claudie:          "348049c9-17de-45f8-8417-326b31dabf6a",
  mila:             "bf072204-b9c6-4982-92af-abef3c87924a",
  ava_winter_park:  "12f2a503-a94e-4a9c-b349-50480ae3cb5b",
  casa_neos:        "0bf4a402-432a-4335-83de-2b8cb33e26ba",
  ava_coconut_grove:"24a8abfa-3b5a-48ec-8169-881f13a25f56",
};

const OT_VENUES = [
  "claudie", "casa_neos", "ava_coconut_grove", "ava_winter_park", "mila", "mila_omakase",
];

const KITCHEN_GROUP_IDS = {
  claudie:           "500000037853698711",
  ava_coconut_grove: "500000056033936853",
  ava_winter_park:   "500000013674501001",
  mm_ava:            "500000020877751155",
  casa_neos:         "500000037911188149",
  casa_neos_lounge:  "500000060638376351",
  mila:              "500000000001501691",
  mm_mila:           "500000020878616311",
};

const OT_RESTAURANTS = {
  claudie:           1384252,
  casa_neos:         1304860,
  ava_coconut_grove: 1443061,
  ava_winter_park:   1208074,
  mila:              1054648,
  mila_omakase:      1271149,
};

// ── Date helpers ────────────────────────────────────────────────────────────

/** Returns { startDate, endDate, weekLabel } for last week (ISO week). weeksAgo=0 → last full week */
function lastWeekRange(weeksAgo = 0) {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun
  const daysToLastMon = (dow === 0 ? 6 : dow - 1) + 7 + weeksAgo * 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysToLastMon);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => d.toISOString().slice(0, 10);

  // ISO week number
  const jan4 = new Date(monday.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const weekNum = Math.round((monday - startOfWeek1) / (7 * 86400000)) + 1;
  const weekLabel = `${monday.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;

  return { startDate: fmt(monday), endDate: fmt(sunday), weekLabel };
}

// ── Toast session ───────────────────────────────────────────────────────────

function getSessionCookies() {
  if (!fs.existsSync(SESSION_FILE)) throw new Error("No toast-session.json. Run intercept.js first.");
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  return session.cookies
    .filter(c => c.domain.includes("toasttab.com"))
    .map(c => `${c.name}=${c.value}`)
    .join("; ");
}

// ── CSV parser ──────────────────────────────────────────────────────────────

function parseCSV(csvText) {
  const lines = csvText.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const fields = [];
    let cur = "", inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { fields.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    fields.push(cur.trim());
    const row = {};
    headers.forEach((h, i) => { if (fields[i] !== undefined) row[h] = fields[i].replace(/^"|"$/g, ""); });
    return row;
  });
}

// ── Toast kitchen timing fetch ──────────────────────────────────────────────

async function fetchKitchenTiming(venueKey) {
  console.log(`  [toast] Fetching kitchen timing for ${venueKey}...`);
  const cookies = getSessionCookies();
  const headers = {
    Cookie: cookies,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "*/*",
    "X-Requested-With": "XMLHttpRequest",
    Referer: "https://www.toasttab.com/restaurants/admin/reports/home",
  };

  const groupId = KITCHEN_GROUP_IDS[venueKey];
  let qs = `excel=true&reportDateRange=lastWeek&numberOfRestaurants=1`;
  if (groupId) qs += `&reportGroupIds=${groupId}`;

  const triggerRes = await axios.get(
    `${TOAST_ADMIN}/restaurantkitchenreports/kitchendetailstable?${qs}`,
    { headers, validateStatus: () => true }
  );
  const s3Url = triggerRes.headers["location"];
  if (!s3Url) throw new Error(`[${venueKey}] No S3 URL in response (status ${triggerRes.status})`);

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const s3Res = await axios.get(s3Url, { validateStatus: () => true });
    const d = s3Res.data;
    if (d.downloadUrl) {
      const csvRes = await axios.get(d.downloadUrl, { responseType: "arraybuffer", validateStatus: () => true });
      const csvText = Buffer.from(csvRes.data).toString("latin1");
      const rows = parseCSV(csvText);
      console.log(`  [toast] ${venueKey}: ${rows.length} tickets`);
      return rows;
    }
    if (d.status === "ERROR" || d.status === "FAILED") throw new Error(`[${venueKey}] Report error: ${d.message}`);
  }
  throw new Error(`[${venueKey}] Kitchen timing CSV export timed out`);
}

// ── Item fulfillment custom report fetch ────────────────────────────────────

async function fetchItemFulfillment(venueKey, reportUuid) {
  console.log(`  [toast] Fetching item fulfillment custom report for ${venueKey} (${reportUuid})...`);
  const cookies = getSessionCookies();
  const headers = {
    Cookie: cookies,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "*/*",
    "X-Requested-With": "XMLHttpRequest",
    Referer: "https://www.toasttab.com/restaurants/admin/reports/home",
  };

  const triggerRes = await axios.get(
    `${TOAST_ADMIN}/restaurants/admin/reports/custom-reports/${reportUuid}?reportDateRange=lastWeek&excel=true`,
    { headers, validateStatus: () => true }
  );
  const s3Url = triggerRes.headers["location"];
  if (!s3Url) throw new Error(`[${venueKey}] No S3 URL for item fulfillment (status ${triggerRes.status})`);

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const s3Res = await axios.get(s3Url, { validateStatus: () => true });
    const d = s3Res.data;
    if (d.downloadUrl) {
      const csvRes = await axios.get(d.downloadUrl, { responseType: "arraybuffer", validateStatus: () => true });
      const csvText = Buffer.from(csvRes.data).toString("latin1");
      const rows = parseCSV(csvText);
      // Parse into {menuItem, count, avgSeconds}
      const items = rows
        .filter(r => r["Menu Item"] || r["Item"] || r["item"])
        .map(r => {
          const menuItem = r["Menu Item"] || r["Item"] || r["item"] || "";
          const count = parseInt(r["Count"] || r["count"] || r["Quantity"] || "0") || 0;
          const avgStr = r["Avg Fulfillment Time"] || r["Average Fulfillment Time"] || r["avg_fulfillment_time"] || "";
          let avgSeconds = null;
          if (typeof avgStr === "number") {
            avgSeconds = avgStr;
          } else {
            const m = String(avgStr).match(/(\d+)\s*minute[^0-9]*(\d+)\s*second/);
            if (m) avgSeconds = parseInt(m[1]) * 60 + parseInt(m[2]);
            else {
              const m2 = String(avgStr).match(/(\d+)\s*minute/);
              if (m2) avgSeconds = parseInt(m2[1]) * 60;
              else {
                const m3 = String(avgStr).match(/^(\d+):(\d+)$/);
                if (m3) avgSeconds = parseInt(m3[1]) * 60 + parseInt(m3[2]);
                else {
                  const m4 = String(avgStr).match(/(\d+)\s*second/);
                  if (m4) avgSeconds = parseInt(m4[1]);
                }
              }
            }
          }
          return { menuItem, count, avgSeconds };
        })
        .filter(r => r.menuItem && r.avgSeconds != null);
      console.log(`  [toast] ${venueKey}: ${items.length} menu items from custom report`);
      return items;
    }
    if (d.status === "ERROR" || d.status === "FAILED") throw new Error(`[${venueKey}] Custom report error: ${d.message}`);
  }
  throw new Error(`[${venueKey}] Item fulfillment custom report timed out`);
}

// ── OpenTable auth ──────────────────────────────────────────────────────────

let _otRefreshPromise = null;

async function refreshOTSession() {
  // Prevent concurrent refresh races — reuse in-flight promise
  if (_otRefreshPromise) return _otRefreshPromise;
  _otRefreshPromise = _doRefreshOTSession().finally(() => { _otRefreshPromise = null; });
  return _otRefreshPromise;
}

async function _doRefreshOTSession() {
  console.log("  [OT] Refreshing session token via Okta + OAuth...");
  const { chromium } = await import("playwright");

  const authRes = await axios.post("https://restauth.opentable.com/api/v1/authn",
    { username: OT_USERNAME, password: OT_PASSWORD },
    { headers: { "Content-Type": "application/json", Accept: "application/json" }, validateStatus: () => true }
  );
  const sessionToken = authRes.data?.sessionToken;
  if (!sessionToken) throw new Error("OT auth failed: " + JSON.stringify(authRes.data).slice(0, 200));

  const oauthUrl = `https://restauth.opentable.com/oauth2/default/v1/authorize` +
    `?client_id=${OT_CLIENT_ID}` +
    `&redirect_uri=https://guestcenter.opentable.com/login/callback` +
    `&response_type=code&scope=openid%20email%20profile%20ot4r%20offline_access` +
    `&access_type=offline&sessionToken=${sessionToken}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  let capturedToken = null;
  page.on("response", async resp => {
    if (resp.url().includes("/token") && resp.status() === 200) {
      try { const b = await resp.json(); if (b.access_token) capturedToken = b.access_token; } catch {}
    }
  });

  await page.goto(oauthUrl, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(8000); // extra wait for token endpoint to fire
  const cookies = await context.cookies();
  await browser.close();

  if (!capturedToken) throw new Error("OT OAuth did not return access_token");

  const session = {
    token: capturedToken,
    cookies: cookies.map(c => `${c.name}=${c.value}`).join("; "),
    capturedAt: new Date().toISOString(),
  };
  fs.writeFileSync(OT_SESSION_FILE, JSON.stringify(session, null, 2));
  console.log("  [OT] Session refreshed successfully.");
  return session;
}

async function getOTSession() {
  if (fs.existsSync(OT_SESSION_FILE)) {
    const s = JSON.parse(fs.readFileSync(OT_SESSION_FILE, "utf8"));
    const age = (Date.now() - new Date(s.capturedAt).getTime()) / 60000;
    if (age < 50 && s.token) return s;
  }
  return refreshOTSession();
}

// ── OpenTable covers fetch ──────────────────────────────────────────────────

async function fetchOTCovers(venueKey, startDate, endDate) {
  console.log(`  [OT] Fetching covers for ${venueKey} (${startDate} → ${endDate})...`);
  const rid = OT_RESTAURANTS[venueKey];
  if (!rid) throw new Error(`Unknown OT venue: ${venueKey}`);

  let session = await getOTSession();
  const makeHeaders = s => ({
    Authorization: `Bearer ${s.token}`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "application/json",
    Referer: "https://guestcenter.opentable.com/",
    Cookie: s.cookies,
  });

  const baseUrl = "https://guestcenter.opentable.com/gateway/long-proxies/restaurant-reporting/reportingBiDatasources/api/v5/reservations/";
  let allItems = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const r = await axios.get(baseUrl, {
      params: { rid, startDate, endDate, offset, limit, sort: "-visitDate", stateCategories: "seated,finished", isVisitDate: true },
      headers: makeHeaders(session),
      validateStatus: () => true,
    });
    if (r.status === 401) {
      session = await refreshOTSession();
      continue;
    }
    if (r.status !== 200) throw new Error(`OT API ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
    const items = r.data?.reservations || r.data?.data || (Array.isArray(r.data) ? r.data : []);
    if (items.length === 0) break;
    allItems = allItems.concat(items);
    if (items.length < limit) break;
    offset += limit;
  }

  // Filter & slim down
  const covers = allItems
    .filter(r => ["Done", "SeatedDisputed", "Seated", "Finished", "Arrived"].includes(r.reservationStatus))
    .map(r => ({
      visitDate:    r.visitDate     ? r.visitDate.slice(0, 10) : null,
      seatedTime:   r.seatedDate    || r.seatedTime    || null,
      finishedTime: r.finishedDate  || r.finishedTime  || r.departureTime || null,
      partySize:    r.partySize     ?? r.covers ?? null,
      tableName:    r.tableId       || r.tableName || null,
    }));

  console.log(`  [OT] ${venueKey}: ${covers.length} covers`);
  return covers;
}

// ── Save helpers ────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { startDate, endDate, weekLabel } = lastWeekRange(0);
  console.log(`\n=== weekly-save.js | Week: ${weekLabel} (${startDate} → ${endDate}) ===\n`);

  ensureDir(DATA_DIR);
  const weekDir = path.join(DATA_DIR, weekLabel);
  ensureDir(weekDir);

  const weekEntry = {
    weekLabel,
    startDate,
    endDate,
    venues: {},
  };

  // ── Toast kitchen timing ──────────────────────────────────────────────────
  console.log("─── Toast Kitchen Timing ───");
  for (const venue of KITCHEN_VENUES) {
    try {
      const tickets = await fetchKitchenTiming(venue);
      const outPath = path.join(weekDir, `kitchen-timing-${venue}.json`);
      saveJSON(outPath, { weekLabel, startDate, endDate, venue, tickets });
      if (!weekEntry.venues[venue]) weekEntry.venues[venue] = {};
      weekEntry.venues[venue].tickets = tickets;
    } catch (err) {
      console.error(`  [toast] ERROR for ${venue}:`, err.message);
    }
  }

  // ── Item fulfillment custom reports ──────────────────────────────────────
  console.log("\n─── Item Fulfillment Custom Reports ───");
  for (const [venue, uuid] of Object.entries(CUSTOM_REPORT_IDS)) {
    try {
      const items = await fetchItemFulfillment(venue, uuid);
      const outPath = path.join(weekDir, `item-fulfillment-${venue}.json`);
      saveJSON(outPath, { weekLabel, startDate, endDate, venue, items });
      if (!weekEntry.venues[venue]) weekEntry.venues[venue] = {};
      weekEntry.venues[venue].itemFulfillment = items;
    } catch (err) {
      console.error(`  [toast] ERROR fetching item fulfillment for ${venue}:`, err.message);
    }
  }

  // ── OpenTable covers ──────────────────────────────────────────────────────
  console.log("\n─── OpenTable Covers ───");
  for (const venue of OT_VENUES) {
    try {
      const covers = await fetchOTCovers(venue, startDate, endDate);
      const outPath = path.join(weekDir, `covers-${venue}.json`);
      saveJSON(outPath, { weekLabel, startDate, endDate, venue, covers });
      if (!weekEntry.venues[venue]) weekEntry.venues[venue] = {};
      weekEntry.venues[venue].covers = covers;
    } catch (err) {
      console.error(`  [OT] ERROR for ${venue}:`, err.message);
    }
  }

  // ── Update rolling.json ───────────────────────────────────────────────────
  console.log("\n─── Updating rolling.json ───");
  let rolling = { weeks: [] };
  if (fs.existsSync(ROLLING_FILE)) {
    try { rolling = JSON.parse(fs.readFileSync(ROLLING_FILE, "utf8")); } catch {}
  }

  // Remove any existing entry for this week (idempotent re-run)
  rolling.weeks = rolling.weeks.filter(w => w.weekLabel !== weekLabel);
  // Add new entry at front
  rolling.weeks.unshift(weekEntry);
  // Keep only last 3 weeks
  rolling.weeks = rolling.weeks.slice(0, 3);

  saveJSON(ROLLING_FILE, rolling);
  console.log(`Rolling.json updated: ${rolling.weeks.map(w => w.weekLabel).join(", ")}`);

  // ── Step 4: Build dashboard data from rolling.json ────────────────────────
  console.log("\n─── Building dashboard data from rolling.json ───");
  try {
    const { stdout: s4, stderr: e4 } = await exec("node C:\\Cursor\\toast-mcp-server\\build-dashboard-from-json.js");
    if (s4) console.log(s4.trim());
    if (e4) console.error(e4.trim());
  } catch (err) {
    console.error("ERROR building dashboard data:", err.message);
  }

  // ── Step 5: Rebuild the HTML dashboard ───────────────────────────────────
  console.log("\n─── Rebuilding HTML dashboard ───");
  try {
    const { stdout: s5, stderr: e5 } = await exec("node C:\\Cursor\\toast-mcp-server\\build-unified-v2.cjs");
    if (s5) console.log(s5.trim());
    if (e5) console.error(e5.trim());
  } catch (err) {
    console.error("ERROR rebuilding dashboard:", err.message);
  }

  console.log("\n=== Done! ===");
  console.log(`Data saved to:  ${weekDir}`);
  console.log("Dashboard updated: C:\\Cursor\\toast-mcp-server\\dashboard.html");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
