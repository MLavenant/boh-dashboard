/**
 * Toast BS Actual Updater
 * Fetches bottle service sales from Toast API (Excel methodology) and writes:
 *   - Firebase toastActuals          (day BS totals → calendar overlay)
 *   - Firebase toastVipNights        (per-night VIP tierSummary → Weekly Flash)
 *   - Firebase vipTierActuals        (week rollups → VIP week totals)
 *
 * index.html SCHED is optional — dashboard uses sched-baked.js + Firebase.
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
  getVipTierMap,
  getVipDisplayTiers,
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

/** Match dashboard getISOWeek → "2026-W34" */
function isoWeekKey(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const y = d.getFullYear();
  const s = new Date(y, 0, 1);
  const w = Math.ceil((((d - s) / 86400000) + 1) / 7);
  return y + "-W" + w;
}

function eventKey(venue, date) {
  return (venue + "_" + date).replace(/[^a-zA-Z0-9_-]/g, "_");
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

async function getTableMaps(token, venueGuid, bsNames) {
  const res = await toastGetWithRetry(`${TOAST_BASE}/config/v2/tables`, {
    Authorization: `Bearer ${token}`,
    "Toast-Restaurant-External-ID": venueGuid,
  });
  const tables = Array.isArray(res.data) ? res.data : (res.data?.tables || []);
  const guids = new Set();
  const guidToName = {};
  for (const t of tables) {
    const name = (t.name ?? t.tableName ?? "").trim();
    if (!t.guid || !name) continue;
    guidToName[t.guid] = name;
    if (bsNames.has(name) || bsNames.has(name.toUpperCase()) || bsNames.has(name.toLowerCase())) {
      guids.add(t.guid);
    }
  }
  return { guids, guidToName };
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

function buildTierSummary(byTable, tierMap) {
  const tierSummary = {};
  let vipSold = 0;
  let vipInv = 0;
  for (const [tierName, tierCfg] of Object.entries(tierMap)) {
    const tierTables = [...tierCfg.tables];
    const sold = tierTables.filter(t => (byTable[t] || 0) > 0);
    const totalSales = tierTables.reduce((s, t) => s + (byTable[t] || 0), 0);
    const soldN = sold.length;
    const avg = soldN ? Math.round(totalSales / soldN) : 0;
    const rounded = Math.round(totalSales * 100) / 100;
    tierSummary[tierName] = {
      sold: soldN,
      soldTables: soldN,
      total: tierTables.length,
      totalTables: tierTables.length,
      sales: rounded,
      totalSales: rounded,
      avgPerTable: avg,
      minPerTable: tierCfg.minPerTable,
    };
  }
  return tierSummary;
}

/**
 * @returns {{ byDate: Object, nights: Object }}
 *   byDate[date] = BS total
 *   nights[date] = { totalRevenue, bookedTables, totalTables, tierSummary, ... }
 */
async function fetchBsSales(venueKey, dates) {
  const cfg  = BS_CONFIG[venueKey];
  const guid = VENUES[venueKey];
  const token = await getToken();
  const mapCache = new Map();
  async function mapsForDate(date) {
    const key = (venueKey === "casa_neos" && isCnbcSummerRoof(date)) ? "roof" : "base";
    if (!mapCache.has(key)) {
      mapCache.set(key, await getTableMaps(token, guid, getBsTables(venueKey, date)));
    }
    return mapCache.get(key);
  }
  const byDate = {};
  const nights = {};

  for (const date of dates) {
    if (!isOperatingDay(venueKey, date)) {
      byDate[date] = 0;
      continue;
    }
    const { guids: bsGuids, guidToName } = await mapsForDate(date);
    const tierMap = getVipTierMap(venueKey, date);
    const orders = await getAllOrders(token, guid, date);
    let total = 0;
    const byTable = {};

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

      const tname = hasTable ? (guidToName[order.table.guid] || "") : "";
      for (const check of (order.checks || [])) {
        if (check.voided) continue;
        const amt = (check.selections || []).filter(s => !s.voided).reduce((s, sel) => s + (sel.price || 0), 0);
        if (!amt) continue;
        total += amt;
        if (tname) byTable[tname] = (byTable[tname] || 0) + amt;
      }
    }

    const rounded = Math.round(total * 100) / 100;
    byDate[date] = rounded;

    const tierSummary = buildTierSummary(byTable, tierMap);
    const displayTiers = getVipDisplayTiers(venueKey, date);
    let vipSold = 0;
    let vipInv = 0;
    displayTiers.forEach(t => {
      const x = tierSummary[t];
      if (!x) return;
      vipSold += x.soldTables || 0;
      vipInv += x.totalTables || 0;
    });
    const allSold = Object.keys(byTable).filter(t => byTable[t] > 0).length;

    nights[date] = {
      venue: cfg.label,
      date,
      totalRevenue: Math.round(rounded),
      bookedTables: allSold,
      totalTables: vipInv || Object.values(tierMap).reduce((s, t) => s + t.tables.size, 0),
      vipSoldTables: vipSold,
      tierSummary,
      hasData: rounded > 0 || allSold > 0,
      _source: "toast_excel_bs",
      _period: isoWeekKey(date),
    };

    if (total > 0) {
      log(`  ${cfg.label} | ${date} → $${byDate[date].toLocaleString()} · VIP sold ${vipSold}/${vipInv}`);
    }
    await sleep(200);
  }
  return { byDate, nights };
}

function rollupWeekTiers(venueKey, nightsByDate) {
  const weeks = {};
  Object.keys(nightsByDate || {}).forEach(date => {
    const night = nightsByDate[date];
    if (!night || !night.tierSummary) return;
    const wk = isoWeekKey(date);
    const label = BS_CONFIG[venueKey].label;
    const key = wk + "|" + label;
    if (!weeks[key]) {
      weeks[key] = {
        source: "Toast actual · Excel methodology · auto",
        tiers: {},
        _dates: [],
      };
    }
    weeks[key]._dates.push(date);
    const display = getVipDisplayTiers(venueKey, date);
    display.forEach(tname => {
      const src = night.tierSummary[tname];
      if (!src) return;
      if (!weeks[key].tiers[tname]) {
        weeks[key].tiers[tname] = {
          soldTables: 0,
          totalTables: src.totalTables || 0,
          totalSales: 0,
          avgPerTable: 0,
          minPerTable: src.minPerTable || 0,
        };
      }
      const dest = weeks[key].tiers[tname];
      dest.soldTables += src.soldTables || 0;
      dest.totalSales += src.totalSales || 0;
      dest.totalTables = Math.max(dest.totalTables, src.totalTables || 0);
      dest.minPerTable = src.minPerTable || dest.minPerTable;
    });
  });
  Object.keys(weeks).forEach(k => {
    const w = weeks[k];
    Object.keys(w.tiers).forEach(t => {
      const x = w.tiers[t];
      x.totalSales = Math.round(x.totalSales);
      x.avgPerTable = x.soldTables ? Math.round(x.totalSales / x.soldTables) : 0;
    });
    delete w._dates;
  });
  return weeks;
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
  log("=== Toast BS Actual + VIP Tiers Update Starting ===");

  const dates = getRelevantDates();
  log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}`);

  const venueKeys = ["casa_neos", "mm_mila", "casa_neos_lounge"];
  const allResults = {};
  const allNights = {};
  const failedVenues = [];
  const prevToast = await fbGet("/rdg/toastActuals");
  const prevByVenue = (prevToast && prevToast.byVenueDate) || {};
  const prevVipNights = await fbGet("/rdg/toastVipNights");
  const prevVipEvents = (prevVipNights && prevVipNights.events) || {};
  const prevWeekTiers = await fbGet("/rdg/vipTierActuals") || {};

  for (let i = 0; i < venueKeys.length; i++) {
    const vk = venueKeys[i];
    if (i > 0) await sleep(1500);
    log(`\nFetching ${BS_CONFIG[vk].label}...`);
    try {
      const pack = await fetchBsSales(vk, dates);
      allResults[vk] = pack.byDate;
      allNights[vk] = pack.nights;
    } catch (e) {
      log(`  ERROR: ${e.message}`);
      failedVenues.push(vk);
      const label = BS_CONFIG[vk].label;
      allResults[vk] = Object.assign({}, prevByVenue[label] || {});
      allNights[vk] = {};
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

  /* Merge day totals into prior history (don't wipe older nights). */
  const byVenueDate = Object.assign({}, prevByVenue);
  for (const vk of venueKeys) {
    const label = BS_CONFIG[vk].label;
    byVenueDate[label] = Object.assign({}, prevByVenue[label] || {}, allResults[vk] || {});
  }

  const toastLivePayload = {
    updatedAt: new Date().toISOString(),
    miamiDay: miamiToday(),
    source: "toast_api_cloud_excel",
    byVenueDate,
    updates
  };
  const toastCode = await fbPut("/rdg/toastActuals", toastLivePayload);
  log(`Firebase toastActuals HTTP ${toastCode}`);

  /* Per-night VIP tiers for Weekly Flash (any week in the lookback). */
  const vipEvents = Object.assign({}, prevVipEvents);
  let vipNightCount = 0;
  for (const vk of venueKeys) {
    const nights = allNights[vk] || {};
    Object.keys(nights).forEach(date => {
      const row = nights[date];
      vipEvents[eventKey(row.venue, date)] = row;
      vipNightCount++;
    });
  }
  const vipNightsPayload = {
    updatedAt: new Date().toISOString(),
    miamiDay: miamiToday(),
    source: "toast_excel_bs",
    lookback: { from: dates[0], to: dates[dates.length - 1] },
    events: vipEvents,
  };
  const vipNightsCode = await fbPut("/rdg/toastVipNights", vipNightsPayload);
  log(`Firebase toastVipNights HTTP ${vipNightsCode} · ${vipNightCount} nights refreshed`);

  /* Week rollups for VIP week totals. */
  const weekTiers = Object.assign({}, prevWeekTiers);
  for (const vk of venueKeys) {
    const rolled = rollupWeekTiers(vk, allNights[vk] || {});
    Object.assign(weekTiers, rolled);
  }
  const weekCode = await fbPut("/rdg/vipTierActuals", weekTiers);
  log(`Firebase vipTierActuals HTTP ${weekCode} · ${Object.keys(weekTiers).length} week keys`);

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
    what: "Toast Excel BS → toastActuals + toastVipNights + vipTierActuals",
    message: (toastOk ? "Toast BS+VIP cloud OK" : "Toast BS+VIP cloud PARTIAL") +
      ` · ${positives} with sales · ${zeros} zero nights · ${vipNightCount} VIP nights` + failNote,
    matched: updatedCount,
    changed,
    positives,
    zeros,
    vipNightCount,
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

  log("\n=== Toast BS + VIP Tiers Update Complete ===");
  if (!toastOk) process.exitCode = 1;
})().catch(e => {
  console.error(e);
  process.exit(1);
});
