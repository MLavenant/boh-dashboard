/**
 * Toast BS Actual Updater
 * Fetches bottle service sales from Toast API for the current week
 * and updates bs_a values in the SCHED array inside index.html
 */

const axios  = require("axios");
const fs     = require("fs");
const { execSync } = require("child_process");

const TOAST_BASE     = "https://ws-api.toasttab.com";
const DASHBOARD_PATH = "C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html";

const CLIENT_ID  = "jsS6dB6QotBhmPsOAyBTfl0jFyhAE9ZC";
const API_SECRET = "nyUrcOs_cG4V4YN5f82Z-3esSdg_-mtw7BgtFi59MIypXpuRsquUqOSkHMYy8MA9";

const VENUES = {
  casa_neos:        "c3f36849-5105-44ab-9168-62be1f89a59e",
  mm_mila:          "618a14f3-35d0-4491-9738-92f01c9651b7",
  casa_neos_lounge: "f1f95f8b-80b9-42de-a8ba-47a5fb8aac70",
};

const BS_CONFIG = {
  casa_neos: {
    label: "Casa Neos Beach Club",
    tables: new Set(["34","51","52","31","41","32","33","35","36","42","43","46","48","49",
                     "53","54","55","56","45","44","47","24","25","26","27","28","19","20",
                     "21","22","23","C1","C2","C3","C4","C5","C6","C7","C8","C9","C10",
                     "C1A","C2A","C3A","C4A","C5A","C6A","C7A","C8A","C9A","C10A",
                     "D1","D2","D3","D4","D5","D6","D7"]),
    startFrac: 0.604167, endFrac: 0.833333, crossesMidnight: false,
    schedLabel: "Casa Neos Beach Club",
  },
  mm_mila: {
    label: "MILA Lounge",
    tables: new Set(["402","304","303","302","301","308","410","401","403","404","305","306",
                     "307","408","408bis","407","405","409","406","1","2","3","4","5","6","7",
                     "8","9","10","11","12","1A","2A","3A","4A","5A","6A","7A","8A","9A",
                     "10A","11A","12A","S1","S2","S3","S4","S5","S6","S7","S8","S9","S10",
                     "S11","S12","S13","S14","S15","S16","S17","S18","S19","S20","S21",
                     "S22","S23","S24","S25","S26","S27","S28","S29","S30","73"]),
    startFrac: 0.979167, endFrac: 0.208333, crossesMidnight: true,
    schedLabel: "MILA Lounge",
  },
  casa_neos_lounge: {
    label: "Casa Neos Lounge",
    tables: new Set(["809","808","905","904","903","902","810","906","907","908","909","910",
                     "911","912","901","807","806","805","804","803","L1","L2","L3","L4",
                     "L5","L6","L7","L8","L9","L10","L11","L12","L1A","L2A","L3A","L4A",
                     "L5A","L6A","L7A","L8A","L9A","L10A","L11A","L12A","44"]),
    startFrac: 0.958333, endFrac: 0.208333, crossesMidnight: true,
    includeNoTable: true, sundayStartFrac: 0.75,
    schedLabel: "Casa Neos Lounge",
  },
};

function log(msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function shift(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Returns dates for last week (Mon-Sun) + this week (Mon→today) in Miami time
function getRelevantDates() {
  const nowLocal = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const todayStr = nowLocal.toISOString().slice(0, 10);
  const dow = new Date(todayStr + "T12:00:00Z").getUTCDay(); // 0=Sun

  // This week Mon→today
  const daysToMon = dow === 0 ? 6 : dow - 1;
  const thisMon = shift(todayStr, -daysToMon);

  // Last week Mon→Sun
  const lastMon = shift(thisMon, -7);
  const lastSun = shift(thisMon, -1);

  const dates = [];
  let cur = lastMon;
  while (cur <= todayStr) { dates.push(cur); cur = shift(cur, 1); }
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
    const orders = await getAllOrders(token, guid, date);
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
        if (amt === 0) continue;
        if (!byDate[date]) byDate[date] = 0;
        byDate[date] += amt;
      }
    }
    byDate[date] = Math.round((byDate[date] || 0) * 100) / 100;
    log(`  ${cfg.label} | ${date} → $${byDate[date].toLocaleString()}`);
  }
  return byDate;
}

// Update bs_a for a specific date+venue in the SCHED array inside index.html
// SCHED entries look like: {v:"Casa Neos Beach Club", date:"2026-07-12", ..., bs_a:0, ...}
function updateSchedBsA(html, venue, date, value) {
  // Match the SCHED entry for this venue+date and update bs_a
  // Pattern: look for the entry containing both the venue name and date, then update bs_a
  const venueEscaped = venue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dateEscaped  = date.replace(/-/g, '\\-');

  // Strategy: find the object literal for this show and update its bs_a field
  // Match null or a number for bs_a value
  const valPattern = `(?:[\\d.]+|null)`;
  const pattern = new RegExp(
    `(\\{[^{}]*?"${venueEscaped}"[^{}]*?"${date}"[^{}]*?bs_a\\s*:\\s*)${valPattern}`, "g"
  );
  const replaced = html.replace(pattern, `$1${value}`);
  if (replaced === html) {
    const pattern2 = new RegExp(
      `(\\{[^{}]*?"${date}"[^{}]*?"${venueEscaped}"[^{}]*?bs_a\\s*:\\s*)${valPattern}`, "g"
    );
    return html.replace(pattern2, `$1${value}`);
  }
  return replaced;
}

(async () => {
  log("=== Toast BS Actual Update Starting ===");

  const dates = getRelevantDates();
  log(`Fetching BS data for: ${dates.join(", ")}`);

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

  // Read dashboard HTML
  let html = fs.readFileSync(DASHBOARD_PATH, "latin1");
  let updatedCount = 0;

  for (const vk of venueKeys) {
    const cfg = BS_CONFIG[vk];
    const byDate = allResults[vk];
    for (const [date, sales] of Object.entries(byDate)) {
      if (sales === 0) continue;
      const before = html;
      html = updateSchedBsA(html, cfg.schedLabel, date, sales);
      if (html !== before) {
        log(`  Updated SCHED: ${cfg.schedLabel} | ${date} → $${sales.toLocaleString()}`);
        updatedCount++;
      }
    }
  }

  if (updatedCount === 0) {
    log("\nNo SCHED entries matched (dates may not be in calendar yet, or already up to date).");
  } else {
    log(`\nUpdated ${updatedCount} bs_a values in index.html`);
  }

  fs.writeFileSync(DASHBOARD_PATH, html, "latin1");

  // Git commit & push
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  try {
    execSync(
      `cd "${DASHBOARD_PATH.replace("index.html","")}" && git add -A && git commit -m "Auto-refresh: Toast BS Actual — ${today}" && git push origin main`,
      { stdio: "inherit", shell: "cmd.exe" }
    );
    log("✅ Pushed to GitHub");
  } catch (e) {
    log("Git note: " + e.message.split("\n")[0]);
  }

  log("\n=== Toast BS Update Complete ===");
})();
