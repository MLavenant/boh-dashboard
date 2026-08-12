/**
 * Toast BS Actual Updater
 * Fetches bottle service sales from Toast API and writes Firebase toastActuals
 * (calendar overlay). index.html SCHED is optional — dashboard uses sched-baked.js.
 */

const axios  = require("axios");
const fs     = require("fs");
const https  = require("https");
const { execSync } = require("child_process");

const TOAST_BASE     = "https://ws-api.toasttab.com";
const DASHBOARD_PATH = process.env.DASHBOARD_PATH || "C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html";
const FB_DB          = "rdg-dj-dashboard-default-rtdb.firebaseio.com";

const CLIENT_ID  = process.env.TOAST_CLIENT_ID  || "jsS6dB6QotBhmPsOAyBTfl0jFyhAE9ZC";
const API_SECRET = process.env.TOAST_API_SECRET || "nyUrcOs_cG4V4YN5f82Z-3esSdg_-mtw7BgtFi59MIypXpuRsquUqOSkHMYy8MA9";

const VENUES = {
  casa_neos:        "c3f36849-5105-44ab-9168-62be1f89a59e",
  mm_mila:          "618a14f3-35d0-4491-9738-92f01c9651b7",
  casa_neos_lounge: "f1f95f8b-80b9-42de-a8ba-47a5fb8aac70",
};

const {
  BS_CONFIG,
  getBsTables,
  includeNoTable,
  isOperatingDay,
  isCnbcSummerRoof,
} = require("./bs-config.cjs");

function log(msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function shift(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function miamiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function getRelevantDates() {
  const todayStr = miamiToday();
  const dates = [];
  for (let i = 13; i >= 0; i--) dates.push(shift(todayStr, -i));
  return dates;
}

function fbPut(fbPath, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: FB_DB,
      path: fbPath + ".json",
      method: "PUT",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, (r) => {
      r.resume();
      r.on("end", () => resolve(r.statusCode || 0));
    });
    req.on("error", () => resolve(0));
    req.write(body);
    req.end();
  });
}

function fbGet(fbPath) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: FB_DB,
      path: fbPath + ".json",
      method: "GET"
    }, (r) => {
      let d = "";
      r.on("data", c => d += c);
      r.on("end", () => {
        try {
          resolve(r.statusCode >= 200 && r.statusCode < 300 ? JSON.parse(d || "null") : null);
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

async function getToken() {
  const res = await axios.post(`${TOAST_BASE}/authentication/v1/authentication/login`, {
    clientId: CLIENT_ID, clientSecret: API_SECRET, userAccessType: "TOAST_MACHINE_CLIENT",
  });
  return res.data.token.accessToken;
}

async function toastGetWithRetry(url, headers, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await axios.get(url, { headers, timeout: 60000 });
    } catch (e) {
      lastErr = e;
      const code = e.response && e.response.status;
      if (code !== 429 && code !== 503) throw e;
      const wait = Math.min(45000, 2000 * Math.pow(2, i));
      log(`  Toast HTTP ${code} — retry in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function getTableGuids(token, venueGuid, bsNames) {
  const res = await toastGetWithRetry(`${TOAST_BASE}/config/v2/tables`, {
    Authorization: `Bearer ${token}`,
    "Toast-Restaurant-External-ID": venueGuid,
  });
  const tables = Array.isArray(res.data) ? res.data : (res.data?.tables || []);
  const guids = new Set();
  for (const t of tables) {
    const name = (t.name ?? t.tableName ?? "").trim();
    if (t.guid && (bsNames.has(name) || bsNames.has(name.toUpperCase()) || bsNames.has(name.toLowerCase())))
      guids.add(t.guid);
  }
  return guids;
}

async function getAllOrders(token, venueGuid, date) {
  const businessDate = date.replace(/-/g, "");
  const headers = { Authorization: `Bearer ${token}`, "Toast-Restaurant-External-ID": venueGuid };
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const res = await toastGetWithRetry(
      `${TOAST_BASE}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`,
      headers
    );
    const batch = Array.isArray(res.data) ? res.data : Object.values(res.data || {});
    all.push(...batch);
    if (batch.length < 100) break;
    await sleep(250);
  }
  return all;
}

async function fetchBsSales(venueKey, dates) {
  const cfg  = BS_CONFIG[venueKey];
  const guid = VENUES[venueKey];
  const token = await getToken();
  const guidCache = new Map();
  async function guidsForDate(date) {
    const key = (venueKey === "casa_neos" && isCnbcSummerRoof(date)) ? "roof" : "base";
    if (!guidCache.has(key)) {
      guidCache.set(key, await getTableGuids(token, guid, getBsTables(venueKey, date)));
    }
    return guidCache.get(key);
  }
  const byDate = {};

  for (const date of dates) {
    if (!isOperatingDay(venueKey, date)) {
      byDate[date] = 0;
      continue;
    }
    const bsGuids = await guidsForDate(date);
    const orders = await getAllOrders(token, guid, date);
    let total = 0;
    for (const order of orders) {
      const hasTable  = !!(order.table?.guid);
      const isBsTable = bsGuids.has(order.table?.guid ?? "");
      if (!isBsTable && !(includeNoTable(venueKey, date) && !hasTable)) continue;

      const openedUtc = order.openedDate;
      if (!openedUtc) continue;
      const localMs  = new Date(openedUtc).getTime() - 4 * 60 * 60 * 1000;
      const localDate = new Date(localMs);
      const timeFrac  = (localDate.getUTCHours() * 60 + localDate.getUTCMinutes()) / 1440;
      const isSunday  = new Date(date + "T12:00:00Z").getUTCDay() === 0;
      const startFrac = (isSunday && cfg.sundayStartFrac !== undefined) ? cfg.sundayStartFrac : cfg.startFrac;
      const inWindow  = cfg.crossesMidnight
        ? (timeFrac >= startFrac || timeFrac <= cfg.endFrac)
        : (timeFrac >= startFrac && timeFrac <= cfg.endFrac);
      if (!inWindow) continue;

      for (const check of (order.checks || [])) {
        if (check.voided) continue;
        const amt = (check.selections || []).filter(s => !s.voided).reduce((s, sel) => s + (sel.price || 0), 0);
        total += amt;
      }
    }
    byDate[date] = Math.round(total * 100) / 100;
    if (total > 0) log(`  ${cfg.label} | ${date} → $${byDate[date].toLocaleString()}`);
    await sleep(200);
  }
  return byDate;
}

function applyBsActual(entry, newBsA) {
  const fee = entry.fee || entry.cost || 0;
  const prev = entry.bs_a;
  entry.bs_a = newBsA;
  if (entry.bs_m != null) {
    entry.beat = newBsA >= entry.bs_m ? 1 : 0;
    entry._s = newBsA >= entry.bs_m ? "beat" : "miss";
  } else if (fee > 0) {
    entry._s = "nd";
  }
  entry.roi_a = fee > 0 ? Math.round(newBsA / fee * 10000) / 10000 : 0;
  return prev !== newBsA;
}

function buildUpdatesFromResults(salesByVenueDate) {
  const updates = [];
  Object.keys(salesByVenueDate || {}).forEach(vk => {
    const label = (BS_CONFIG[vk] && BS_CONFIG[vk].label) || vk;
    const byDate = salesByVenueDate[vk] || {};
    Object.keys(byDate).forEach(date => {
      updates.push({ venue: label, date, bs_a: byDate[date], dj: null });
    });
  });
  return updates;
}

function updateSchedInHtml(html, salesByVenueDate) {
  const schedMatch = html.match(/var SCHED = (\[[\s\S]*?\]);/);
  if (!schedMatch) {
    log("NOTE: SCHED not in index.html — Firebase toastActuals is the live source");
    return { html, count: 0, changed: 0, updates: buildUpdatesFromResults(salesByVenueDate) };
  }

  let sched;
  try { sched = JSON.parse(schedMatch[1]); }
  catch (e) {
    log("ERROR parsing SCHED: " + e.message);
    return { html, count: 0, changed: 0, updates: buildUpdatesFromResults(salesByVenueDate) };
  }

  const today = miamiToday();
  let count = 0;
  let changed = 0;
  const updates = [];
  sched.forEach(e => {
    const venue = e.venue || e.v || "";
    const date  = e.d || "";
    const venueKey = Object.keys(salesByVenueDate).find(vk =>
      BS_CONFIG[vk] && BS_CONFIG[vk].label === venue
    );
    if (!venueKey) return;
    const byDate = salesByVenueDate[venueKey];
    if (!byDate || byDate[date] === undefined) return;
    if (byDate[date] === 0 && date >= today) return;

    const newBsA = byDate[date];
    const didChange = applyBsActual(e, newBsA);
    count++;
    if (didChange) changed++;
    updates.push({ venue, date, bs_a: newBsA, dj: e.dj || null });
    log(`  ✅ ${venue} | ${date} → $${newBsA.toLocaleString()} | ${e._s || "nd"} (min $${(e.bs_m||0).toLocaleString()})`);
  });

  const bsMatch = html.match(/var BS\s*= (\[[\s\S]*?\]);/);
  let bs = [];
  if (bsMatch) {
    try { bs = JSON.parse(bsMatch[1]); } catch (e) {}
    bs.forEach(e => {
      const venue = e.venue || e.v || "";
      const date  = e.d || "";
      const venueKey = Object.keys(salesByVenueDate).find(vk =>
        BS_CONFIG[vk] && BS_CONFIG[vk].label === venue
      );
      if (!venueKey) return;
      const byDate = salesByVenueDate[venueKey];
      if (!byDate || byDate[date] === undefined) return;
      if (byDate[date] === 0 && date >= today) return;
      applyBsActual(e, byDate[date]);
    });
  }

  html = html.replace(/var SCHED = \[[\s\S]*?\];/, "var SCHED = " + JSON.stringify(sched) + ";");
  if (bsMatch) {
    html = html.replace(/var BS\s*= \[[\s\S]*?\];/, "var BS    = " + JSON.stringify(bs) + ";");
  }

  return { html, count, changed, updates };
}

(async () => {
  log("=== Toast BS Actual Update Starting ===");

  const dates = getRelevantDates();
  log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}`);

  const venueKeys = ["casa_neos", "mm_mila", "casa_neos_lounge"];
  const allResults = {};
  const failedVenues = [];
  const prevToast = await fbGet("/rdg/toastActuals");
  const prevByVenue = (prevToast && prevToast.byVenueDate) || {};

  for (let i = 0; i < venueKeys.length; i++) {
    const vk = venueKeys[i];
    if (i > 0) await sleep(1500);
    log(`\nFetching ${BS_CONFIG[vk].label}...`);
    try {
      allResults[vk] = await fetchBsSales(vk, dates);
    } catch (e) {
      log(`  ERROR: ${e.message}`);
      failedVenues.push(vk);
      const label = BS_CONFIG[vk].label;
      allResults[vk] = Object.assign({}, prevByVenue[label] || {});
      log(`  Kept ${Object.keys(allResults[vk]).length} prior nights for ${label}`);
    }
  }

  let updatedCount = 0;
  let changed = 0;
  let updates = buildUpdatesFromResults(allResults);

  if (fs.existsSync(DASHBOARD_PATH)) {
    let html = fs.readFileSync(DASHBOARD_PATH, "utf8");
    const result = updateSchedInHtml(html, allResults);
    updatedCount = result.count;
    changed = result.changed;
    updates = result.updates && result.updates.length ? result.updates : updates;
    if (result.count > 0) {
      fs.writeFileSync(DASHBOARD_PATH, result.html, "utf8");
      log(`\n✅ Matched ${updatedCount} shows (${changed} value changes) in index.html`);
    } else {
      log("\nNo SCHED entries updated (Firebase toastActuals is source of truth).");
    }
  } else {
    log("\nDASHBOARD_PATH missing — Firebase toastActuals only.");
  }

  const byVenueDate = Object.assign({}, prevByVenue);
  for (const vk of venueKeys) {
    byVenueDate[BS_CONFIG[vk].label] = allResults[vk];
  }

  const toastLivePayload = {
    updatedAt: new Date().toISOString(),
    miamiDay: miamiToday(),
    source: "toast_api_cloud",
    byVenueDate,
    updates
  };
  const toastCode = await fbPut("/rdg/toastActuals", toastLivePayload);
  log(`Firebase toastActuals HTTP ${toastCode}`);

  const positives = (updates || []).filter(u => (u.bs_a || 0) > 0).length;
  const zeros = (updates || []).filter(u => (u.bs_a || 0) === 0).length;
  const toastOk = failedVenues.length === 0;
  const failNote = failedVenues.length
    ? (" · partial fail: " + failedVenues.map(v => BS_CONFIG[v].label).join(", "))
    : "";
  const statusCode = await fbPut("/rdg/scrapeStatus/toast", {
    ok: toastOk,
    at: new Date().toISOString(),
    atLocal: new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
    schedule: "Punctual dispatch ~8:25 ET · GitHub schedule = late backup",
    what: "Toast bottle-service Actual → Firebase toastActuals (+ optional index.html)",
    message: (toastOk ? "Toast BS cloud OK" : "Toast BS cloud PARTIAL") +
      ` · ${positives} with sales · ${zeros} zero nights · ${changed} changed in file` + failNote,
    matched: updatedCount,
    changed,
    positives,
    zeros,
    failedVenues
  });
  log(`Firebase scrapeStatus/toast HTTP ${statusCode}`);

  if (process.env.GITHUB_ACTIONS) {
    log("GitHub Actions: skip local git push (workflow handles it)");
  } else if (updatedCount > 0) {
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    try {
      execSync(
        `cd "${DASHBOARD_PATH.replace("index.html","")}" && git add index.html && git commit -m "Auto-refresh: Toast BS Actual — ${today}" && git push origin main`,
        { stdio: "inherit", shell: "cmd.exe" }
      );
      log("✅ Pushed to GitHub");
    } catch (e) {
      log("Git: " + e.message.split("\n")[0]);
    }
  }

  log("\n=== Toast BS Update Complete ===");
  if (!toastOk) process.exitCode = 1;
})().catch(e => {
  console.error(e);
  process.exit(1);
});
