process.stderr.write("=== TOAST MCP v10 LOADED ===\n");
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config({ path: "C:\\Cursor\\toast-mcp-server\\.env", override: true });

const SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\toast-session.json";
const TOAST_ADMIN = "https://www.toasttab.com";

function getSessionCookies() {
  if (!fs.existsSync(SESSION_FILE)) throw new Error("No session file. Run intercept.js to login first.");
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  return session.cookies
    .filter(c => c.domain.includes("toasttab.com"))
    .map(c => `${c.name}=${c.value}`)
    .join("; ");
}

// Report group IDs extracted from the Toast admin reports location dropdown
const KITCHEN_GROUP_IDS = {
  // Individual venues
  claudie:              "500000037853698711",
  ava_coconut_grove:    "500000056033936853",
  ava_winter_park:      "500000013674501001",
  mm_ava:               "500000020877751155",
  casa_neos:            "500000037911188149",
  casa_neos_lounge:     "500000060638376351",
  mila:                 "500000000001501691",
  mm_mila:              "500000020878616311",
  // Groups (include all sub-venues)
  claudie_group:        "500000045010094653",
  ava_cg_group:         "500000055174371704",
  ava_wp_group:         "500000045246952250",
  casa_neos_group:      "500000038958898300",
  mila_group:           "500000033825876959",
  mila_full_group:      "500000000001526801",
  rdg:                  "500000045010094652", // all venues (Riviera Dining Group)
  all:                  null,
};

const KITCHEN_VENUE_ENUM = Object.keys(KITCHEN_GROUP_IDS);

function parseCSV(csvText) {
  const lines = csvText.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    // Handle quoted fields with commas inside
    const fields = [];
    let cur = "", inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { fields.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    fields.push(cur.trim());
    const row = {};
    headers.forEach((h, i) => { if (fields[i]) row[h] = fields[i].replace(/^"|"$/g, ""); });
    return row;
  });
}

async function fetchKitchenTimingReport(dateRange, venueKey = "all") {
  const cookies = getSessionCookies();
  const headers = {
    Cookie: cookies,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "*/*",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://www.toasttab.com/restaurants/admin/reports/home",
  };

  const groupId = KITCHEN_GROUP_IDS[venueKey];
  let qs = `excel=true&reportDateRange=${encodeURIComponent(dateRange)}&numberOfRestaurants=1`;
  if (groupId) qs += `&reportGroupIds=${groupId}`;

  // Step 1: trigger CSV export
  const triggerRes = await axios.get(
    `${TOAST_ADMIN}/restaurantkitchenreports/kitchendetailstable?${qs}`,
    { headers, validateStatus: () => true }
  );
  const s3Url = triggerRes.headers["location"];
  if (!s3Url) throw new Error(`No S3 URL in response (status ${triggerRes.status})`);

  // Step 2: poll S3 until downloadUrl appears
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const s3Res = await axios.get(s3Url, { validateStatus: () => true });
    const d = s3Res.data;
    if (d.downloadUrl) {
      // Step 3: fetch the actual CSV
      const csvRes = await axios.get(d.downloadUrl, { responseType: "arraybuffer", validateStatus: () => true });
      const csvText = Buffer.from(csvRes.data).toString("latin1");
      return parseCSV(csvText);
    }
    if (d.status === "ERROR" || d.status === "FAILED") throw new Error("Report error: " + d.message);
  }
  throw new Error("Kitchen timing CSV export timed out");
}

const TOAST_BASE = "https://ws-api.toasttab.com";

const VENUES = {
  claudie:          process.env.GUID_CLAUDIE,
  ava_cg:           process.env.GUID_AVA_CG,
  ava_cg2:          process.env.GUID_AVA_CG2,
  casa_neos:        process.env.GUID_CASA_NEOS,
  casa_neos_lounge: process.env.GUID_CASA_NEOS_LOUNGE,
  mm_mila:          process.env.GUID_MM_MILA,
  mm_ava:           process.env.GUID_MM_AVA,
  mila:             process.env.GUID_MILA,
  ava:              process.env.GUID_AVA,
};

const VENUE_ENUM = ["claudie", "ava_cg", "ava_cg2", "casa_neos", "casa_neos_lounge", "mm_mila", "mm_ava", "mila", "ava"];

async function getToastToken() {
  const res = await axios.post(
    `${TOAST_BASE}/authentication/v1/authentication/login`,
    {
      clientId:       process.env.TOAST_CLIENT_ID,
      clientSecret:   process.env.TOAST_API_SECRET,
      userAccessType: "TOAST_MACHINE_CLIENT",
    }
  );
  return res.data.token.accessToken;
}

async function toastGet(path, venueGuid) {
  const token = await getToastToken();
  const res = await axios.get(`${TOAST_BASE}${path}`, {
    headers: {
      Authorization:                  `Bearer ${token}`,
      "Toast-Restaurant-External-ID": venueGuid,
    },
  });
  return res.data;
}

// Fetch all orders for a business date using ordersBulk (returns full objects with checks)
async function getAllOrdersForDate(venueGuid, date) {
  const token = await getToastToken();
  const businessDate = date.replace(/-/g, "");
  const headers = {
    Authorization:                  `Bearer ${token}`,
    "Toast-Restaurant-External-ID": venueGuid,
  };
  const allOrders = [];
  for (let page = 1; page <= 100; page++) {
    const res = await axios.get(
      `${TOAST_BASE}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`,
      { headers }
    );
    const data = res.data;
    const batch = Array.isArray(data) ? data : (data && typeof data === "object" ? Object.values(data) : []);
    allOrders.push(...batch);
    if (batch.length < 100) break;
  }
  return allOrders;
}

const server = new McpServer({ name: "toast-mcp", version: "1.0.0" });

server.tool(
  "get_orders",
  "Fetch all orders with full details (checks, payments, items) for a venue on a specific business date",
  {
    venue: z.enum(VENUE_ENUM),
    date:  z.string().describe("Date in YYYY-MM-DD format, e.g. 2026-06-30"),
  },
  async ({ venue, date }) => {
    const orders = await getAllOrdersForDate(VENUES[venue], date);
    return { content: [{ type: "text", text: JSON.stringify(orders, null, 2) }] };
  }
);

server.tool(
  "get_labor",
  "Fetch labor and shift data for a venue on a specific date",
  {
    venue: z.enum(VENUE_ENUM),
    date:  z.string().describe("Date in YYYY-MM-DD format, e.g. 2026-06-30"),
  },
  async ({ venue, date }) => {
    const data = await toastGet(
      `/labor/v1/timeEntries?startDate=${date}T00:00:00.000-0400&endDate=${date}T23:59:59.000-0400`,
      VENUES[venue]
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_menu",
  "Fetch the full menu for a venue",
  { venue: z.enum(VENUE_ENUM) },
  async ({ venue }) => {
    const data = await toastGet(`/menus/v2/menus`, VENUES[venue]);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_ticket_details",
  "Get the Ticket Details report for a venue and date. Returns one row per check with ticket number, table, server, dining option, open/close times, guest count, subtotal, discounts, tax, tips, total, payment types, and line items.",
  {
    venue: z.enum(VENUE_ENUM),
    date:  z.string().describe("Date in YYYY-MM-DD format, e.g. 2026-06-30"),
  },
  async ({ venue, date }) => {
    const orders = await getAllOrdersForDate(VENUES[venue], date);

    const tickets = [];
    for (const order of orders) {
      for (const check of (order.checks || [])) {
        const items = (check.selections || []).map(sel => ({
          name:      sel.displayName ?? "Unknown",
          qty:       sel.quantity ?? 1,
          price:     sel.price ?? 0,
          modifiers: (sel.modifiers || []).map(m => m.displayName).filter(Boolean).join(", ") || null,
          voided:    sel.voided ?? false,
        })).filter(i => !i.voided);

        tickets.push({
          orderGuid:    order.guid,
          checkGuid:    check.guid,
          ticketNumber: order.displayNumber ?? null,
          checkNumber:  check.displayNumber ?? null,
          tabName:      check.tabName ?? null,
          table:        order.table?.name ?? null,
          server:       order.server ? `${order.server.firstName ?? ""} ${order.server.lastName ?? ""}`.trim() || null : null,
          diningOption: order.diningOption?.name ?? null,
          revenueCenter:order.revenueCenter?.name ?? null,
          openedAt:     order.openedDate ?? null,
          closedAt:     order.closedDate ?? check.paidDate ?? null,
          guestCount:   order.numberOfGuests ?? null,
          items,
          itemCount:    items.reduce((s, i) => s + i.qty, 0),
          subtotal:     check.amount ?? 0,
          tax:          check.taxAmount ?? 0,
          tips:         check.totalTips ?? 0,
          gratuity:     check.totalGratuity ?? 0,
          discounts:    check.totalDiscounts ?? 0,
          total:        check.totalAmount ?? 0,
          payments:     (check.payments || []).map(p => ({ type: p.type, amount: p.amount, tip: p.tipAmount ?? 0 })),
          voided:       check.voided ?? false,
        });
      }
    }

    tickets.sort((a, b) => new Date(a.openedAt) - new Date(b.openedAt));

    const open = tickets.filter(t => !t.voided);
    const sum  = f => open.reduce((s, t) => s + (t[f] ?? 0), 0);

    const summary = {
      venue, date,
      totalTickets:   tickets.length,
      voidedTickets:  tickets.filter(t => t.voided).length,
      totalRevenue:   sum("total").toFixed(2),
      totalTax:       sum("tax").toFixed(2),
      totalTips:      sum("tips").toFixed(2),
      totalGratuity:  sum("gratuity").toFixed(2),
      totalDiscounts: sum("discounts").toFixed(2),
    };

    return {
      content: [{ type: "text", text: JSON.stringify({ summary, tickets }, null, 2) }],
    };
  }
);

server.tool(
  "get_kitchen_timing",
  "Get the Kitchen Timing / Ticket Details report from Toast. Returns each ticket with Fired Date, Fulfilled Date, and Fulfillment Time — the exact data from the Toast Kitchen Timing report page. Supports per-venue filtering.",
  {
    dateRange: z.enum(["today", "yesterday", "lastWeek", "thisWeek", "thisMonth", "lastMonth"])
      .describe("Date range for the report"),
    venue: z.enum(["claudie", "ava_coconut_grove", "ava_winter_park", "mm_ava", "casa_neos", "casa_neos_lounge", "mila", "mm_mila", "claudie_group", "ava_cg_group", "ava_wp_group", "casa_neos_group", "mila_group", "mila_full_group", "rdg", "all"])
      .default("all")
      .describe("Venue to filter by. Use 'all' for all venues combined."),
  },
  async ({ dateRange, venue = "all" }) => {
    const rows = await fetchKitchenTimingReport(dateRange, venue);
    const summary = {
      venue,
      dateRange,
      totalTickets: rows.length,
    };
    const text = JSON.stringify({ summary, tickets: rows }, null, 2);
    return { content: [{ type: "text", text }] };
  }
);

// ── Shared helper for menu reports (item details, modifier details, etc.) ──────
async function fetchMenuReport(endpoint, dateRange, venueKey = "all") {
  const cookies = getSessionCookies();
  const reqHeaders = {
    Cookie: cookies,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "*/*",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://www.toasttab.com/restaurants/admin/reports/home",
  };

  const groupId = KITCHEN_GROUP_IDS[venueKey];
  let qs = `excel=true&reportDateRange=${encodeURIComponent(dateRange)}&numberOfRestaurants=1`;
  if (groupId) qs += `&reportGroupIds=${groupId}`;

  const triggerRes = await axios.get(
    `${TOAST_ADMIN}${endpoint}?${qs}`,
    { headers: reqHeaders, validateStatus: () => true }
  );
  const s3Url = triggerRes.headers["location"];
  if (!s3Url) throw new Error(`No S3 URL in response (status ${triggerRes.status})`);

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const s3Res = await axios.get(s3Url, { validateStatus: () => true });
    const d = s3Res.data;
    if (d.downloadUrl) {
      const csvRes = await axios.get(d.downloadUrl, { responseType: "arraybuffer", validateStatus: () => true });
      const csvText = Buffer.from(csvRes.data).toString("latin1");
      return parseCSV(csvText);
    }
    if (d.status === "ERROR" || d.status === "FAILED") throw new Error("Report error: " + d.message);
  }
  throw new Error("Menu report CSV export timed out");
}

server.tool(
  "get_item_details",
  "Get the Item Details report from Toast (the #selection-details report page). Returns one row per menu item selection with Location, Order #, Sent Date, Menu Item, Menu Group, Net Price, Qty, Voided, etc. — across all 32 columns. Fetches per-venue and merges to avoid the 50k row limit.",
  {
    dateRange: z.enum(["today", "yesterday", "lastWeek", "thisWeek", "thisMonth", "lastMonth"])
      .describe("Date range for the report"),
    venue: z.enum(["claudie", "ava_coconut_grove", "ava_winter_park", "mm_ava", "casa_neos", "casa_neos_lounge", "mila", "mm_mila", "claudie_group", "ava_cg_group", "ava_wp_group", "casa_neos_group", "mila_group", "mila_full_group", "rdg", "all"])
      .default("all")
      .describe("Venue to filter by. Use 'all' to fetch all venues individually and merge (avoids 50k limit)."),
  },
  async ({ dateRange, venue = "all" }) => {
    const ENDPOINT = "/restaurants/admin/reports/menu/toplevelitemselections";

    // For "all" or "rdg", fetch each individual venue and merge to avoid the 50k row cap
    const ALL_VENUES = [
      "claudie", "ava_coconut_grove", "ava_winter_park", "mm_ava",
      "casa_neos", "casa_neos_lounge", "mila", "mm_mila",
    ];

    let allRows = [];
    const venuesToFetch = (venue === "all" || venue === "rdg") ? ALL_VENUES : [venue];
    const perVenueCounts = {};

    for (const v of venuesToFetch) {
      const rows = await fetchMenuReport(ENDPOINT, dateRange, v);
      perVenueCounts[v] = rows.length;
      allRows = allRows.concat(rows);
    }

    const summary = {
      venue,
      dateRange,
      totalRows: allRows.length,
      perVenue: perVenueCounts,
    };

    return { content: [{ type: "text", text: JSON.stringify({ summary, items: allRows }, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════
// OpenTable — session helpers
// ═══════════════════════════════════════════════════════════

const OT_SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\ot-session.json";
const OT_USERNAME = "matthias@rivieradininggroup.com";
const OT_PASSWORD = "MattLondon0401!";
const OT_CLIENT_ID = "0oabit60qvY1wTxAv5d6";

const OT_RESTAURANTS = {
  claudie:           1384252,
  casa_neos:         1304860,
  ava_coconut_grove: 1443061,
  ava_winter_park:   1208074,
  mila:              1054648,
  mila_omakase:      1271149,
};

let _otRefreshPromise = null;

/** Refresh OpenTable Bearer token — mutex prevents concurrent races. */
async function refreshOTSession() {
  if (_otRefreshPromise) return _otRefreshPromise;
  _otRefreshPromise = _doRefreshOTSession().finally(() => { _otRefreshPromise = null; });
  return _otRefreshPromise;
}

async function _doRefreshOTSession() {
  const { chromium } = await import("playwright");
  // Step 1: Okta session token
  const authRes = await axios.post("https://restauth.opentable.com/api/v1/authn",
    { username: OT_USERNAME, password: OT_PASSWORD },
    { headers: { "Content-Type": "application/json", Accept: "application/json" }, validateStatus: () => true }
  );
  const sessionToken = authRes.data?.sessionToken;
  if (!sessionToken) throw new Error("OT auth failed: " + JSON.stringify(authRes.data).slice(0, 200));

  // Step 2: Exchange via OAuth in headless browser
  const oauthUrl = `https://restauth.opentable.com/oauth2/default/v1/authorize` +
    `?client_id=${OT_CLIENT_ID}` +
    `&redirect_uri=https://guestcenter.opentable.com/login/callback` +
    `&response_type=code&scope=openid%20email%20profile%20ot4r%20offline_access` +
    `&access_type=offline&sessionToken=${sessionToken}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let capturedToken = null;
  page.on("response", async resp => {
    if (resp.url().includes("/token") && resp.status() === 200) {
      try { const b = await resp.json(); if (b.access_token) capturedToken = b.access_token; } catch {}
    }
  });

  await page.goto(oauthUrl, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(8000);

  const cookies = await context.cookies();
  await browser.close();

  if (!capturedToken) throw new Error("OT OAuth did not return access_token");

  const session = { token: capturedToken, cookies: cookies.map(c => `${c.name}=${c.value}`).join("; "), capturedAt: new Date().toISOString() };
  fs.writeFileSync(OT_SESSION_FILE, JSON.stringify(session, null, 2));
  return session;
}

async function getOTSession() {
  if (fs.existsSync(OT_SESSION_FILE)) {
    const s = JSON.parse(fs.readFileSync(OT_SESSION_FILE, "utf8"));
    // Token is typically valid for 1 hour; refresh if older than 50 minutes
    const age = (Date.now() - new Date(s.capturedAt).getTime()) / 60000;
    if (age < 50 && s.token) return s;
  }
  return refreshOTSession();
}

/** Fetch all pages of OT reservations for a venue and date range. */
async function fetchOTReservations(rid, startDate, endDate) {
  const session = await getOTSession();
  const headers = {
    Authorization: `Bearer ${session.token}`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "application/json",
    Referer: "https://guestcenter.opentable.com/",
    Cookie: session.cookies,
  };
  const baseUrl = "https://guestcenter.opentable.com/gateway/long-proxies/restaurant-reporting/reportingBiDatasources/api/v5/reservations/";

  let allItems = [];
  let offset = 0;
  const limit = 500;
  while (true) {
    const r = await axios.get(baseUrl, {
      params: { rid, startDate, endDate, offset, limit, sort: "-visitDate", stateCategories: "seated,finished", isVisitDate: true },
      headers,
      validateStatus: () => true,
    });
    if (r.status === 401) {
      // Token expired mid-fetch, refresh and retry once
      const newSession = await refreshOTSession();
      headers.Authorization = `Bearer ${newSession.token}`;
      headers.Cookie = newSession.cookies;
      continue;
    }
    if (r.status !== 200) throw new Error(`OT API ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
    const items = r.data?.reservations || r.data?.data || (Array.isArray(r.data) ? r.data : []);
    if (items.length === 0) break;
    allItems = allItems.concat(items);
    if (items.length < limit) break;
    offset += limit;
  }
  return allItems;
}

/** Compute last-week date range (Mon–Sun). weeksAgo=0 → last week, 1 → 2 weeks ago, etc. */
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
  return { startDate: fmt(monday), endDate: fmt(sunday) };
}

// ── get_covers tool ────────────────────────────────────────────────────────
server.tool(
  "get_covers",
  "Get OpenTable reservation/covers data. Returns visit date, seated date, finished date, party size, and table — filtered to Seated & Done status. Fetches last week by default; set weeksBack=3 for last 3 weeks of data.",
  {
    venue: z.enum(["claudie", "casa_neos", "ava_coconut_grove", "ava_winter_park", "mila", "mila_omakase", "all"])
      .default("claudie")
      .describe("Venue to fetch covers for"),
    weeksBack: z.number().int().min(1).max(4).default(1)
      .describe("How many weeks of data to fetch (1=last week only, 3=last 3 weeks)"),
  },
  async ({ venue = "claudie", weeksBack = 1 }) => {
    const venuesToFetch = venue === "all"
      ? Object.entries(OT_RESTAURANTS)
      : [[venue, OT_RESTAURANTS[venue]]];

    const KEEP_COLS = ["visitDate", "seatedTime", "finishedTime", "partySize", "tableName"];

    const allResults = {};
    for (const [vname, rid] of venuesToFetch) {
      if (!rid) continue;
      const weeklyData = [];
      for (let w = 0; w < weeksBack; w++) {
        const { startDate, endDate } = lastWeekRange(w);
        const raw = await fetchOTReservations(rid, startDate, endDate);
        // Filter to seated/done and select only needed columns
        const filtered = raw
          .filter(r => ["Done", "SeatedDisputed", "Seated", "Finished", "Arrived"].includes(r.reservationStatus))
          .map(r => ({
            visitDate:    r.visitDate        ? r.visitDate.slice(0, 10) : null,
            seatedTime:   r.seatedDate       || r.seatedTime  || null,
            finishedTime: r.finishedDate     || r.finishedTime || r.departureTime || null,
            partySize:    r.partySize        ?? r.covers ?? null,
            tableName:    r.tableId          || r.tableName   || null,
          }));
        weeklyData.push({ weekStartDate: startDate, weekEndDate: endDate, count: filtered.length, reservations: filtered });
      }
      allResults[vname] = weeklyData;
    }

    const summary = { venue, weeksBack, venueRowCounts: Object.fromEntries(Object.entries(allResults).map(([k, v]) => [k, v.reduce((s, w) => s + w.count, 0)])) };
    return { content: [{ type: "text", text: JSON.stringify({ summary, data: allResults }, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════
// Toast Web Bearer Token — for /api/service/ endpoints
// ═══════════════════════════════════════════════════════════

const TOAST_WEB_TOKEN_FILE = "C:\\Cursor\\toast-mcp-server\\toast-web-token.json";
const TOAST_RESTAURANT_SET_GUID = "96e8e2b8-d95d-4432-b574-ceee10cf17d5";

function getMsGuid() {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  const toastCookie = session.cookies.find(c => c.name === "TOAST_SESSION");
  if (!toastCookie) throw new Error("TOAST_SESSION cookie not found");
  const decoded = decodeURIComponent(toastCookie.value);
  const m = decoded.match(/msGuid=([a-f0-9-]{36})/);
  if (!m) throw new Error("msGuid not found in TOAST_SESSION cookie");
  return m[1];
}

async function refreshToastWebToken() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();

  let capturedToken = null;
  context.on("response", async resp => {
    if (resp.url().includes("auth.toasttab.com/oauth/token") && resp.status() === 200) {
      try { const b = await resp.json(); if (b.access_token) capturedToken = b.access_token; } catch {}
    }
  });

  // Load admin page — triggers silent OAuth token refresh
  await page.goto("https://www.toasttab.com/restaurants/admin/reports/home", {
    waitUntil: "domcontentloaded", timeout: 30000,
  }).catch(() => {});
  await page.waitForTimeout(8000);
  await context.storageState({ path: SESSION_FILE });
  await browser.close();

  if (!capturedToken) throw new Error("Could not capture Toast web access token. Session may be expired.");
  const record = { token: capturedToken, capturedAt: new Date().toISOString() };
  fs.writeFileSync(TOAST_WEB_TOKEN_FILE, JSON.stringify(record, null, 2));
  return record;
}

async function getToastWebToken() {
  if (fs.existsSync(TOAST_WEB_TOKEN_FILE)) {
    const s = JSON.parse(fs.readFileSync(TOAST_WEB_TOKEN_FILE, "utf8"));
    const ageMins = (Date.now() - new Date(s.capturedAt).getTime()) / 60000;
    if (ageMins < 50 && s.token) return s.token;
  }
  const record = await refreshToastWebToken();
  return record.token;
}

/** Convert a dateRange enum string to {startDate, endDate} in YYYYMMDD format */
function dateRangeToYYYYMMDD(dateRange, startDateOpt, endDateOpt) {
  if (startDateOpt && endDateOpt) {
    return {
      startDate: startDateOpt.replace(/-/g, ""),
      endDate: endDateOpt.replace(/-/g, ""),
    };
  }
  const now = new Date();
  const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, "");
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const startOfWeek = (d, firstDay = 1) => { // 1=Mon
    const day = d.getDay();
    const diff = (day - firstDay + 7) % 7;
    return addDays(d, -diff);
  };
  switch (dateRange) {
    case "today": {
      const t = fmt(now);
      return { startDate: t, endDate: t };
    }
    case "yesterday": {
      const y = fmt(addDays(now, -1));
      return { startDate: y, endDate: y };
    }
    case "thisWeek": {
      const mon = startOfWeek(now);
      return { startDate: fmt(mon), endDate: fmt(addDays(mon, 6)) };
    }
    case "lastWeek": {
      const mon = startOfWeek(addDays(now, -7));
      return { startDate: fmt(mon), endDate: fmt(addDays(mon, 6)) };
    }
    case "thisMonth": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { startDate: fmt(start), endDate: fmt(end) };
    }
    case "lastMonth": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: fmt(start), endDate: fmt(end) };
    }
    default:
      throw new Error(`Unknown dateRange: ${dateRange}`);
  }
}

// Venue GUIDs for report-generator (web restaurant GUIDs from /restaurantaccess/populateAccessibleRestaurants)
const FULFILLMENT_VENUE_GUIDS = {
  claudie:           "380f8195-ef88-495e-b144-6e3202ccc569",
  ava_coconut_grove: "1c653447-0a27-4f29-8e7c-d9141a8dc66c",
  ava_winter_park:   "0a365c66-d2b9-42ab-8f45-94ea26d50716",
  casa_neos:         "c3f36849-5105-44ab-9168-62be1f89a59e",
  mila:              "38e76bee-b844-427c-b078-260aa025f556",
  mm_ava:            "6f8b68d6-aaff-4d50-b7b9-4582a6ce8da5",
  mm_mila:           "618a14f3-35d0-4491-9738-92f01c9651b7",
};

const FULFILLMENT_VENUE_ENUM = [...Object.keys(FULFILLMENT_VENUE_GUIDS), "all"];

async function fetchItemFulfillmentReport(dateRange, venue = "all", startDateOpt, endDateOpt) {
  const token = await getToastWebToken();
  const { startDate, endDate } = dateRangeToYYYYMMDD(dateRange, startDateOpt, endDateOpt);

  // Use the first venue's location GUID for the restaurant-external-id header
  // (org-wide headers work across all venues for this RDG account)
  const primaryLocationGuid = venue === "all"
    ? Object.values(FULFILLMENT_VENUE_GUIDS)[0]
    : FULFILLMENT_VENUE_GUIDS[venue];

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "application/json",
    Referer: "https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a",
    "toast-restaurant-external-id": primaryLocationGuid,
    "toast-management-set-guid": getMsGuid(),
    "toast-restaurant-set-guid": TOAST_RESTAURANT_SET_GUID,
  };

  // Build locations array — all venues in one inner array for aggregation
  const guids = (venue === "all")
    ? Object.values(FULFILLMENT_VENUE_GUIDS)
    : [FULFILLMENT_VENUE_GUIDS[venue]];

  const locations = [guids.map(guid => ({ locationGuid: guid, locationType: "RESTAURANT" }))];

  const body = {
    renderer: "JSON",
    locations,
    dateRanges: { customDateRanges: [{ startDateYYYYMMDD: startDate, endDateYYYYMMDD: endDate }] },
    panels: [
      {
        outputName: "e2a4e62f-a9a2-4389-b8c5-e15f935f2c3a",
        type: "TABLE",
        source: {
          type: "metrics",
          metrics: ["AVERAGE_ITEM_FULFILLMENT_TIME"],
          groupBy: ["MENU_ITEM_NAME"],
          filters: [],
          comparisons: [],
        },
      },
      {
        outputName: "1e88127f-608c-46a5-adfc-5225e7d6f127",
        type: "TABLE",
        source: {
          type: "metrics",
          metrics: ["AVERAGE_ITEM_FULFILLMENT_TIME"],
          groupBy: ["MENU_ITEM_NAME", "LOCATION_NAME"],
          filters: [],
          comparisons: [],
        },
      },
    ],
    parameters: { customReportGuid: "348049c9-17de-45f8-8417-326b31dabf6a" },
  };

  let genRes = await axios.post(
    "https://www.toasttab.com/api/service/report-generator/v1/customReports/generate",
    body,
    { headers, validateStatus: () => true }
  );

  if (genRes.status === 401) {
    const freshToken = await refreshToastWebToken();
    headers.Authorization = `Bearer ${freshToken}`;
    genRes = await axios.post(
      "https://www.toasttab.com/api/service/report-generator/v1/customReports/generate",
      body,
      { headers, validateStatus: () => true }
    );
  }

  if (genRes.status !== 200) throw new Error(`Report generator API ${genRes.status}: ${JSON.stringify(genRes.data).slice(0, 200)}`);

  const { reportRequestGuid, status: initStatus } = genRes.data;
  if (!reportRequestGuid) throw new Error("No reportRequestGuid in generate response");
  if (initStatus === "ERROR") throw new Error(`Report generation error: ${genRes.data.errorMessage}`);

  // Poll for results
  const resultsUrl = `https://www.toasttab.com/api/service/report-generator/v1/reportRequest/${reportRequestGuid}/results`;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, i === 0 && initStatus === "COMPLETED" ? 0 : 3000));
    const r = await axios.get(resultsUrl, { headers, validateStatus: () => true });
    if (r.status === 200) return r.data;
    if (r.status === 202 || r.status === 404) continue;
    throw new Error(`Results fetch ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  throw new Error("Item fulfillment report timed out waiting for results");
}

server.tool(
  "get_item_fulfillment",
  "Get the average item fulfillment time per menu item from Toast's custom report (Fulfillment time by item CLAUDIE). Returns AVERAGE_ITEM_FULFILLMENT_TIME grouped by MENU_ITEM_NAME and optionally by LOCATION_NAME.",
  {
    dateRange: z.enum(["today", "yesterday", "lastWeek", "thisWeek", "thisMonth", "lastMonth"])
      .describe("Date range for the report"),
    venue: z.enum(FULFILLMENT_VENUE_ENUM)
      .default("all")
      .describe("Venue filter. Use 'all' for all venues combined."),
    startDate: z.string().optional().describe("Custom start date YYYY-MM-DD (overrides dateRange)"),
    endDate: z.string().optional().describe("Custom end date YYYY-MM-DD (overrides dateRange)"),
  },
  async ({ dateRange, venue = "all", startDate, endDate }) => {
    const data = await fetchItemFulfillmentReport(dateRange, venue, startDate, endDate);
    return { content: [{ type: "text", text: JSON.stringify({ dateRange, venue, data }, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════
// Bottle Service Sales — live from Toast
// ═══════════════════════════════════════════════════════════

// Bottle service configuration learned from Excel methodology.
// Table names and time windows per venue. Amounts always come live from Toast.
const BS_CONFIG = {
  casa_neos: {
    label: "Casa Neos Beach Club",
    tables: new Set(["34","51","52","31","41","32","33","35","36","42","43","46","48","49",
                     "53","54","55","56","45","44","47","24","25","26","27","28","19","20",
                     "21","22","23","C1","C2","C3","C4","C5","C6","C7","C8","C9","C10",
                     "C1A","C2A","C3A","C4A","C5A","C6A","C7A","C8A","C9A","C10A",
                     "D1","D2","D3","D4","D5","D6","D7"]),
    startFrac:       0.604167, // 2:30 PM local
    endFrac:         0.833333, // 8:00 PM local
    crossesMidnight: false,
  },
  mm_mila: {
    label: "MILA Lounge (MM Club)",
    tables: new Set(["402","304","303","302","301","308","410","401","403","404","305","306",
                     "307","408","408bis","407","405","409","406","1","2","3","4","5","6","7",
                     "8","9","10","11","12","1A","2A","3A","4A","5A","6A","7A","8A","9A",
                     "10A","11A","12A","S1","S2","S3","S4","S5","S6","S7","S8","S9","S10",
                     "S11","S12","S13","S14","S15","S16","S17","S18","S19","S20","S21",
                     "S22","S23","S24","S25","S26","S27","S28","S29","S30","73"]),
    startFrac:       0.979167, // 11:30 PM local
    endFrac:         0.208333, // 5:00 AM local
    crossesMidnight: true,
  },
  casa_neos_lounge: {
    label: "Casa Neos Lounge",
    tables: new Set(["809","808","905","904","903","902","810","906","907","908","909","910",
                     "911","912","901","807","806","805","804","803","L1","L2","L3","L4",
                     "L5","L6","L7","L8","L9","L10","L11","L12","L1A","L2A","L3A","L4A",
                     "L5A","L6A","L7A","L8A","L9A","L10A","L11A","L12A","44"]),
    startFrac:       0.958333, // 11:00 PM local (weekdays/Sat); Sunday uses 0.75 = 6 PM
    endFrac:         0.208333, // 5:00 AM local
    crossesMidnight: true,
    // CN Lounge also counts orders with no table assignment (archived tables show in Orders Report)
    includeNoTable:  true,
    // Sunday dinner service starts at 6 PM instead of 11 PM
    sundayStartFrac: 0.75,
  },
};

// Fetch all tables for a venue from Toast config API → { tableName: guid }
async function getTableNameMap(venueGuid) {
  try {
    const data = await toastGet("/config/v2/tables", venueGuid);
    const tables = Array.isArray(data) ? data : (data?.tables || data?.results || []);
    const map = {};
    for (const t of tables) {
      const name = t.name ?? t.tableName ?? t.externalId;
      if (name && t.guid) map[String(name).trim()] = t.guid;
    }
    return map;
  } catch (err) {
    return { _error: err.message };
  }
}

// Build a Set of ALL table GUIDs whose names (case-insensitive) are in the given name set.
// Handles duplicate table names (same display name, different GUID) and case mismatches.
async function getBsTableGuids(venueGuid, bsTableNames) {
  const data = await toastGet("/config/v2/tables", venueGuid);
  const tables = Array.isArray(data) ? data : (data?.tables || data?.results || []);
  const guids = new Set();
  for (const t of tables) {
    const name = (t.name ?? t.tableName ?? t.externalId ?? "").trim();
    if (t.guid && (bsTableNames.has(name) || bsTableNames.has(name.toUpperCase()) || bsTableNames.has(name.toLowerCase()))) {
      guids.add(t.guid);
    }
  }
  return guids;
}

// Resolve a named date range to an array of YYYY-MM-DD strings (Miami local time, UTC-4)
function resolveBsDates(range) {
  const nowLocal = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const todayStr = nowLocal.toISOString().slice(0, 10);

  function shift(dateStr, days) {
    const d = new Date(dateStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function span(start, end) {
    const out = [];
    let cur = start;
    while (cur <= end) { out.push(cur); cur = shift(cur, 1); }
    return out;
  }

  const dow = new Date(todayStr + "T12:00:00Z").getUTCDay(); // 0=Sun

  if (range === "today")     return [todayStr];
  if (range === "yesterday") return [shift(todayStr, -1)];

  if (range === "lastWeek") {
    // Mon–Sun of last week
    const daysToLastMon = dow === 0 ? 6 : dow + 6;
    const lastMon = shift(todayStr, -daysToLastMon);
    return span(lastMon, shift(lastMon, 6));
  }
  if (range === "thisWeek") {
    const daysToMon = dow === 0 ? 6 : dow - 1;
    return span(shift(todayStr, -daysToMon), todayStr);
  }

  const yr  = parseInt(todayStr.slice(0, 4));
  const mo  = parseInt(todayStr.slice(5, 7));
  if (range === "thisMonth") {
    return span(`${yr}-${String(mo).padStart(2,"0")}-01`, todayStr);
  }
  if (range === "lastMonth") {
    const lmo  = mo === 1 ? 12 : mo - 1;
    const lyr  = mo === 1 ? yr - 1 : yr;
    const last = new Date(yr, mo - 1, 0).getDate();
    return span(`${lyr}-${String(lmo).padStart(2,"0")}-01`,
                `${lyr}-${String(lmo).padStart(2,"0")}-${String(last).padStart(2,"0")}`);
  }
  return [todayStr];
}

server.tool(
  "get_bottle_service_sales",
  `Calculate Bottle Service sales for a venue and date range, pulled live from Toast API.
Uses the same source as get_ticket_details (ordersBulk API with resolved table names).
Applies the exact same formula as the Excel Bottle Service tab:
  - Filters by the venue's designated bottle service tables (by name)
  - Filters by the venue's time window (Beach Club 2:30-8 PM; MILA 11:30 PM-5 AM; CN Lounge 11 PM-5 AM)
  - Sums check.amount (pre-tax subtotal) per business date
Returns BS sales totals per date.`,
  {
    venue: z.enum(["casa_neos", "mm_mila", "casa_neos_lounge"]),
    dateRange: z.enum(["today", "yesterday", "lastWeek", "thisWeek", "thisMonth", "lastMonth"])
      .describe("Date range — use lastWeek for the standard weekly update"),
  },
  async ({ venue, dateRange }) => {
    const cfg      = BS_CONFIG[venue];
    const venueKey = venue === "casa_neos" ? "casa_neos" : venue === "mm_mila" ? "mm_mila" : "casa_neos_lounge";
    const guid     = VENUES[venueKey];
    const dates    = resolveBsDates(dateRange);

    // Build a set of ALL table GUIDs matching BS table names (case-insensitive, handles duplicates)
    const bsTableGuids = await getBsTableGuids(guid, cfg.tables);

    const byDate = {};

    for (const date of dates) {
      const orders = await getAllOrdersForDate(guid, date);

      for (const order of orders) {
        const hasTable  = !!(order.table?.guid);
        const isBsTable = bsTableGuids.has(order.table?.guid ?? "");

        // For venues with includeNoTable, also count orders with no table assignment
        // (archived/deleted tables show names in the Orders Report CSV but null in the live API)
        if (!isBsTable && !(cfg.includeNoTable && !hasTable)) continue;

        // Convert openedDate (UTC ISO) to Miami local time fraction
        const openedUtc = order.openedDate;
        if (!openedUtc) continue;
        const localMs   = new Date(openedUtc).getTime() - 4 * 60 * 60 * 1000;
        const localDate = new Date(localMs);
        const timeFrac  = (localDate.getUTCHours() * 60 + localDate.getUTCMinutes()) / 1440;

        // Sunday uses extended start time if configured
        const isSunday   = new Date(date + "T12:00:00Z").getUTCDay() === 0;
        const startFrac  = (isSunday && cfg.sundayStartFrac !== undefined) ? cfg.sundayStartFrac : cfg.startFrac;
        const inWindow   = cfg.crossesMidnight
          ? (timeFrac >= startFrac || timeFrac <= cfg.endFrac)
          : (timeFrac >= startFrac && timeFrac <= cfg.endFrac);
        if (!inWindow) continue;

        // Sum selection prices (pre-tax subtotal = Excel "Amount" column)
        for (const check of (order.checks || [])) {
          if (check.voided) continue;
          const amt = (check.selections || [])
            .filter(s => !s.voided)
            .reduce((sum, s) => sum + (s.price || 0), 0);
          if (amt === 0) continue;
          if (!byDate[date]) byDate[date] = { total: 0, checks: 0 };
          byDate[date].total  += amt;
          byDate[date].checks += 1;
        }
      }
    }

    for (const d of Object.keys(byDate)) {
      byDate[d].total = Math.round(byDate[d].total * 100) / 100;
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          venue:     cfg.label,
          dateRange,
          dates,
          results: dates.map(d => ({
            date:          d,
            bsSales:       byDate[d]?.total  ?? 0,
            matchedChecks: byDate[d]?.checks ?? 0,
          })),
          grandTotal: Math.round(
            Object.values(byDate).reduce((s, v) => s + v.total, 0) * 100
          ) / 100,
        }, null, 2),
      }],
    };
  }
);

// ═══════════════════════════════════════════════════════════
// VIP Table Breakdown — per-table and per-tier BS sales
// ═══════════════════════════════════════════════════════════

// Tier mapping for Casa Neos Beach Club (from Floor Plan Bottle Service tab)
const TIER_MAP_CASA_NEOS = {
  Diamond:   { tables: new Set(["34","51","52"]),                                                                                         minPerTable: 4000 },
  Prestige:  { tables: new Set(["31","41"]),                                                                                              minPerTable: 3500 },
  Platinum:  { tables: new Set(["32","33","35","36","42","43","45","46","47","48","49","53","54","55","56"]),                              minPerTable: 2000 },
  Gold:      { tables: new Set(["24","25","26","27","28"]),                                                                               minPerTable: 1500 },
  Riverwalk: { tables: new Set(["19","20","21","22","23"]),                                                                               minPerTable: 1000 },
  Cabana:    { tables: new Set(["C1","C2","C3","C4","C5","C6","C7","C8","C9","C10","C1A","C2A","C3A","C4A","C5A","C6A","C7A","C8A","C9A","C10A"]), minPerTable: 500 },
  Deck:      { tables: new Set(["D1","D2","D3","D4","D5","D6","D7"]),                                                                     minPerTable: 500 },
};

server.tool(
  "get_vip_table_breakdown",
  `Returns per-table and per-tier Bottle Service sales for Casa Neos Beach Club.
Uses the same logic as get_bottle_service_sales (BS tables, 2:30–8 PM window).
Groups results by tier: Diamond, Prestige, Platinum, Gold, Riverwalk, Cabana, Deck.
Returns for each tier: tables in tier, tables sold (had revenue), total sales, avg per table, min per table target.
Also returns per-table detail: table name, tier, sales, checks.`,
  {
    dateRange: z.enum(["today","yesterday","lastWeek","thisWeek","thisMonth","lastMonth"])
      .describe("Date range — use lastWeek for the weekly VIP recap"),
  },
  async ({ dateRange }) => {
    const cfg  = BS_CONFIG.casa_neos;
    const guid = VENUES.casa_neos;
    const dates = resolveBsDates(dateRange);

    // Build table→GUID map for BS tables
    const data   = await toastGet("/config/v2/tables", guid);
    const tables = Array.isArray(data) ? data : (data?.tables || data?.results || []);
    const nameToGuid = {};
    const guidToName = {};
    for (const t of tables) {
      const name = (t.name ?? t.tableName ?? t.externalId ?? "").trim();
      if (name && t.guid) { nameToGuid[name] = t.guid; guidToName[t.guid] = name; }
    }

    // Build GUID set for all BS tables
    const bsGuids = new Set();
    for (const [name] of Object.entries(nameToGuid)) {
      if (cfg.tables.has(name) || cfg.tables.has(name.toUpperCase())) bsGuids.add(nameToGuid[name]);
    }

    // Accumulate per-table sales across all dates
    const byTable = {};

    for (const date of dates) {
      const orders = await getAllOrdersForDate(guid, date);
      for (const order of orders) {
        const tguid = order.table?.guid ?? "";
        if (!bsGuids.has(tguid)) continue;

        const localMs  = new Date(order.openedDate).getTime() - 4 * 60 * 60 * 1000;
        const localDt  = new Date(localMs);
        const timeFrac = (localDt.getUTCHours() * 60 + localDt.getUTCMinutes()) / 1440;
        if (!(timeFrac >= cfg.startFrac && timeFrac <= cfg.endFrac)) continue;

        const tname = guidToName[tguid] ?? tguid;
        if (!byTable[tname]) byTable[tname] = { total: 0, checks: 0 };

        for (const check of (order.checks || [])) {
          if (check.voided) continue;
          const amt = (check.selections || []).filter(s => !s.voided).reduce((s, sel) => s + (sel.price || 0), 0);
          if (amt === 0) continue;
          byTable[tname].total  += amt;
          byTable[tname].checks += 1;
        }
      }
    }

    // Round table totals
    for (const t of Object.keys(byTable)) byTable[t].total = Math.round(byTable[t].total * 100) / 100;

    // Build tier summary
    const byTier = {};
    for (const [tierName, tierCfg] of Object.entries(TIER_MAP_CASA_NEOS)) {
      const tierTables = [...tierCfg.tables];
      const sold = tierTables.filter(t => (byTable[t]?.total ?? 0) > 0);
      const totalSales = tierTables.reduce((s, t) => s + (byTable[t]?.total ?? 0), 0);
      byTier[tierName] = {
        totalTables:   tierTables.length,
        soldTables:    sold.length,
        totalSales:    Math.round(totalSales * 100) / 100,
        avgPerTable:   sold.length > 0 ? Math.round(totalSales / sold.length * 100) / 100 : 0,
        minPerTable:   tierCfg.minPerTable,
        tableDetail:   tierTables.map(t => ({
          table:  t,
          sales:  byTable[t]?.total  ?? 0,
          checks: byTable[t]?.checks ?? 0,
        })).sort((a, b) => b.sales - a.sales),
      };
    }

    const grandTotal = Object.values(byTier).reduce((s, t) => s + t.totalSales, 0);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          venue: "Casa Neos Beach Club",
          dateRange,
          dates,
          byTier,
          grandTotal: Math.round(grandTotal * 100) / 100,
        }, null, 2),
      }],
    };
  }
);

// ─── FourVenues upcoming events ───────────────────────────────────────────────

const FV_HEADERS = {
  "storage-bucket": "pro",
  "referer": "https://pro.fourvenues.com/",
  "device-id": "Zzzwxt508tg69u21ul5d3enp3tKIcRPS",
  "accept": "application/json, text/plain, */*",
  "content-type": "application/json",
  "app-id": "ajihln7fc0006jhmmi4lh75s2lI9O3jx",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

const FV_VENUES = {
  "casa_neos_bc":     { id: "lah0f2isk8qmsg0zapu016rarffvp0xz", name: "Casa Neos Beach Club" },
  "casa_neos_lounge": { id: "mrph20a941lojvdykvq598p0b8j3576j", name: "Casa Neos Lounge" },
  "mila_lounge":      { id: "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM", name: "MILA Lounge" },
};

async function fvGetUpcomingEvents(venueKey, daysAhead = 90) {
  const venue = FV_VENUES[venueKey];
  if (!venue) throw new Error(`Unknown venue: ${venueKey}`);
  const todaySec = Math.floor(Date.now() / 1000);
  const endSec = todaySec + daysAhead * 86400;
  const q = JSON.stringify({
    negocio_id: venue.id, eliminado: 0, cancelado: 0,
    fecha: { "$gte": todaySec, "$lte": endSec }
  });
  const opts = JSON.stringify({ limit: 100, sort: { fecha: 1 } });
  const url = `https://api.fourvenues.com/eventos/?query=${encodeURIComponent(q)}&options=${encodeURIComponent(opts)}`;
  const res = await axios.get(url, { headers: FV_HEADERS });
  return (res.data.data || []).map(e => ({
    id: e._id,
    name: e.nombre || "",
    date: new Date(e.fecha * 1000).toISOString().split("T")[0],
    dateFriendly: new Date(e.fecha * 1000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
    timeStart: e.inicio ? `${String(Math.floor(e.inicio / 100)).padStart(2,"0")}:${String(e.inicio % 100).padStart(2,"0")}` : null,
    timeEnd: e.fin   ? `${String(Math.floor(e.fin   / 100)).padStart(2,"0")}:${String(e.fin   % 100).padStart(2,"0")}` : null,
    active: e.activo,
    description: e.descripcion || "",
  }));
}

server.tool(
  "get_fourvenues_upcoming_events",
  "Get all upcoming DJ / event bookings from FourVenues for one or all RDG venues. Use for forecasting, scheduling, and planning.",
  {
    venue: z.enum(["all", "casa_neos_bc", "casa_neos_lounge", "mila_lounge"])
      .default("all")
      .describe("Which venue to query. Use 'all' to get every venue."),
    days_ahead: z.number().int().min(1).max(365).default(90)
      .describe("How many days into the future to look (default 90)."),
  },
  async ({ venue, days_ahead }) => {
    const keys = venue === "all" ? Object.keys(FV_VENUES) : [venue];
    const results = {};
    for (const key of keys) {
      try {
        results[FV_VENUES[key].name] = await fvGetUpcomingEvents(key, days_ahead);
      } catch (e) {
        results[FV_VENUES[key]?.name || key] = { error: e.message };
      }
    }
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
