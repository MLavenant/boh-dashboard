/**
 * Toast BS Actual Updater
 * Fetches bottle service sales from Toast API for last week + this week
 * and updates bs_a values in the SCHED array inside index.html
 */

const axios  = require("axios");
const fs     = require("fs");
const { execSync } = require("child_process");

const TOAST_BASE     = "https://ws-api.toasttab.com";
const DASHBOARD_PATH = process.env.DASHBOARD_PATH || "C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html";

const CLIENT_ID  = process.env.TOAST_CLIENT_ID  || "jsS6dB6QotBhmPsOAyBTfl0jFyhAE9ZC";
const API_SECRET = process.env.TOAST_API_SECRET || "nyUrcOs_cG4V4YN5f82Z-3esSdg_-mtw7BgtFi59MIypXpuRsquUqOSkHMYy8MA9";

const VENUES = {
  casa_neos:        "c3f36849-5105-44ab-9168-62be1f89a59e",
  mm_mila:          "618a14f3-35d0-4491-9738-92f01c9651b7",
  casa_neos_lounge: "f1f95f8b-80b9-42de-a8ba-47a5fb8aac70",
};

// Operating DJ nights (matches Venue ROI rules): only these days get BS Actual written
const BS_CONFIG = {
  casa_neos: {
    label: "Casa Neos Beach Club",
    days: [6, 0], // Saturday, Sunday
    tables: new Set(["34","51","52","31","41","32","33","35","36","42","43","46","48","49",
                     "53","54","55","56","45","44","47","24","25","26","27","28","19","20",
                     "21","22","23","C1","C2","C3","C4","C5","C6","C7","C8","C9","C10",
                     "C1A","C2A","C3A","C4A","C5A","C6A","C7A","C8A","C9A","C10A",
                     "D1","D2","D3","D4","D5","D6","D7"]),
    startFrac: 0.604167, endFrac: 0.833333, crossesMidnight: false,
  },
  mm_mila: {
    label: "MILA Lounge",
    days: [3, 4, 5, 6], // Wednesday–Saturday
    tables: new Set(["402","304","303","302","301","308","410","401","403","404","305","306",
                     "307","408","408bis","407","405","409","406","1","2","3","4","5","6","7",
                     "8","9","10","11","12","1A","2A","3A","4A","5A","6A","7A","8A","9A",
                     "10A","11A","12A","S1","S2","S3","S4","S5","S6","S7","S8","S9","S10",
                     "S11","S12","S13","S14","S15","S16","S17","S18","S19","S20","S21",
                     "S22","S23","S24","S25","S26","S27","S28","S29","S30","73"]),
    startFrac: 0.979167, endFrac: 0.208333, crossesMidnight: true,
  },
  casa_neos_lounge: {
    label: "Casa Neos Lounge",
    days: [4, 5, 6, 0], // Thursday–Sunday
    tables: new Set(["809","808","905","904","903","902","810","906","907","908","909","910",
                     "911","912","901","807","806","805","804","803","L1","L2","L3","L4",
                     "L5","L6","L7","L8","L9","L10","L11","L12","L1A","L2A","L3A","L4A",
                     "L5A","L6A","L7A","L8A","L9A","L10A","L11A","L12A","44"]),
    startFrac: 0.958333, endFrac: 0.208333, crossesMidnight: true,
    includeNoTable: true, sundayStartFrac: 0.75,
  },
};

function isOperatingDay(venueKey, dateStr) {
  const cfg = BS_CONFIG[venueKey];
  if (!cfg || !cfg.days) return true;
  const dow = new Date(dateStr + "T12:00:00").getDay();
  return cfg.days.includes(dow);
}

function log(msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function shift(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Returns last 14 days of dates (catches any recent shows)
function getRelevantDates() {
  const nowLocal = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const todayStr = nowLocal.toISOString().slice(0, 10);
  const dates = [];
  for (let i = 13; i >= 0; i--) dates.push(shift(todayStr, -i));
  return dates;
}

async function getToken() {
  const res = await axios.post(`${TOAST_BASE}/authentication/v1/authentication/login`, {
    clientId: CLIENT_ID, clientSecret: API_SECRET, userAccessType: "TOAST_MACHINE_CLIENT",
  });
  return res.data.token.accessToken;
}

async function getTableGuids(token, venueGuid, bsNames) {
  const res = await axios.get(`${TOAST_BASE}/config/v2/tables`, {
    headers: { Authorization: `Bearer ${token}`, "Toast-Restaurant-External-ID": venueGuid },
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
    const res = await axios.get(
      `${TOAST_BASE}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`,
      { headers }
    );
    const batch = Array.isArray(res.data) ? res.data : Object.values(res.data || {});
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function fetchBsSales(venueKey, dates) {
  const cfg  = BS_CONFIG[venueKey];
  const guid = VENUES[venueKey];
  const token = await getToken();
  const bsGuids = await getTableGuids(token, guid, cfg.tables);
  const byDate = {};

  for (const date of dates) {
    if (!isOperatingDay(venueKey, date)) {
      byDate[date] = 0;
      continue;
    }
    const orders = await getAllOrders(token, guid, date);
    let total = 0;
    for (const order of orders) {
      const hasTable  = !!(order.table?.guid);
      const isBsTable = bsGuids.has(order.table?.guid ?? "");
      if (!isBsTable && !(cfg.includeNoTable && !hasTable)) continue;

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
  }
  return byDate;
}

// Parse SCHED array from HTML, update entries, re-inject (also fixes beat/_s/roi_a)
function updateSchedInHtml(html, salesByVenueDate) {
  // Extract the SCHED array
  const schedMatch = html.match(/var SCHED = (\[[\s\S]*?\]);/);
  if (!schedMatch) { log("ERROR: SCHED array not found"); return { html, count: 0 }; }

  let sched;
  try { sched = JSON.parse(schedMatch[1]); }
  catch (e) { log("ERROR parsing SCHED: " + e.message); return { html, count: 0 }; }

  let count = 0;
  sched.forEach(e => {
    const venue = e.venue || e.v || "";
    const date  = e.d || "";
    const venueKey = Object.keys(salesByVenueDate).find(vk =>
      BS_CONFIG[vk] && BS_CONFIG[vk].label === venue
    );
    if (!venueKey) return;
    const byDate = salesByVenueDate[venueKey];
    if (!byDate || byDate[date] === undefined || byDate[date] === 0) return;

    const newBsA = byDate[date];
    e.bs_a  = newBsA;
    e.beat  = newBsA >= e.bs_m ? 1 : 0;
    e._s    = newBsA >= e.bs_m ? "beat" : "miss";
    e.roi_a = e.fee > 0 ? Math.round(newBsA / e.fee * 10000) / 10000 : 0;
    count++;
    log(`  ✅ ${venue} | ${date} → $${newBsA.toLocaleString()} | ${e._s} (min $${(e.bs_m||0).toLocaleString()})`);
  });

  // Also update the BS array (same structure as SCHED)
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
      if (!byDate || !byDate[date]) return;
      const newBsA = byDate[date];
      e.bs_a  = newBsA;
      e.beat  = newBsA >= e.bs_m ? 1 : 0;
      e.roi_a = e.cost > 0 ? Math.round(newBsA / e.cost * 10000) / 10000 : 0;
    });
  }

  // Re-inject both arrays
  const newSchedJS = "var SCHED = " + JSON.stringify(sched) + ";";
  html = html.replace(/var SCHED = \[[\s\S]*?\];/, newSchedJS);
  if (bsMatch) {
    const newBsJS = "var BS    = " + JSON.stringify(bs) + ";";
    html = html.replace(/var BS\s*= \[[\s\S]*?\];/, newBsJS);
  }

  return { html, count };
}

(async () => {
  log("=== Toast BS Actual Update Starting ===");

  const dates = getRelevantDates();
  log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}`);

  const venueKeys = ["casa_neos", "mm_mila", "casa_neos_lounge"];
  const allResults = {};

  for (const vk of venueKeys) {
    log(`\nFetching ${BS_CONFIG[vk].label}...`);
    try {
      allResults[vk] = await fetchBsSales(vk, dates);
    } catch (e) {
      log(`  ERROR: ${e.message}`);
      allResults[vk] = {};
    }
  }

  // Read dashboard HTML and update SCHED + BS arrays
  let html = fs.readFileSync(DASHBOARD_PATH, "latin1");
  const { html: newHtml, count: updatedCount } = updateSchedInHtml(html, allResults);
  html = newHtml;
  fs.writeFileSync(DASHBOARD_PATH, html, "latin1");

  if (updatedCount === 0) {
    log("\nNo SCHED entries updated.");
  } else {
    log(`\n✅ Updated ${updatedCount} shows (bs_a + beat + _s + roi_a) in index.html`);
  }

  // Git commit & push (skip on GitHub Actions — workflow pushes)
  if (process.env.GITHUB_ACTIONS) {
    log("GitHub Actions: skip local git push (workflow handles it)");
  } else {
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  try {
    execSync(
      `cd "${DASHBOARD_PATH.replace("index.html","")}" && git add -A && git commit -m "Auto-refresh: Toast BS Actual — ${today}" && git push origin main`,
      { stdio: "inherit", shell: "cmd.exe" }
    );
    log("✅ Pushed to GitHub");
  } catch (e) {
    log("Git: " + e.message.split("\n")[0]);
  }
  }

  log("\n=== Toast BS Update Complete ===");
})();
