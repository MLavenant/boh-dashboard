/**
 * Fetches per-table BS breakdown for last week (Jul 7-13) for all 3 venues.
 * Uses Toast API with OAuth (same as vip-all.mjs).
 * Outputs a VIP_VENUES JSON array ready to embed into index.html.
 */
import dotenv from "dotenv";
dotenv.config({ path: "C:\\Cursor\\toast-mcp-server\\.env", override: true });
import axios from "axios";
import fs from "fs";

const TOAST_BASE = "https://ws-api.toasttab.com";

async function getToken() {
  const r = await axios.post(`${TOAST_BASE}/authentication/v1/authentication/login`, {
    clientId: process.env.TOAST_CLIENT_ID,
    clientSecret: process.env.TOAST_API_SECRET,
    userAccessType: "TOAST_MACHINE_CLIENT",
  });
  return r.data.token.accessToken;
}

const VENUE_GUIDS = {
  "Casa Neos Beach Club": process.env.GUID_CASA_NEOS,
  "MILA Lounge":          process.env.GUID_MM_MILA,
  "Casa Neos Lounge":     process.env.GUID_CASA_NEOS_LOUNGE,
};

const BS_CONFIG = {
  "Casa Neos Beach Club": {
    startFrac: 0.604167, endFrac: 0.833333, crossesMidnight: false,
  },
  "MILA Lounge": {
    startFrac: 0.979167, endFrac: 0.208333, crossesMidnight: true,
  },
  "Casa Neos Lounge": {
    startFrac: 0.958333, endFrac: 0.208333, crossesMidnight: true,
    includeNoTable: true, sundayStartFrac: 0.75,
  },
};

const TIER_MAPS = {
  "Casa Neos Beach Club": {
    Diamond:   { tables: new Set(["34","51","52"]),                                                            minPerTable: 4000, color:"#b9f2ff", textColor:"#0a4a6e" },
    Prestige:  { tables: new Set(["31","41"]),                                                                 minPerTable: 3500, color:"#e8d5ff", textColor:"#4a0080" },
    Platinum:  { tables: new Set(["32","33","35","36","42","43","45","46","47","48","49","53","54","55","56"]),minPerTable: 2000, color:"#e8e8e8", textColor:"#2d2d2d" },
    Gold:      { tables: new Set(["24","25","26","27","28"]),                                                  minPerTable: 1500, color:"#fff3cd", textColor:"#7d5a00" },
    Riverwalk: { tables: new Set(["19","20","21","22","23"]),                                                  minPerTable: 1000, color:"#d4edda", textColor:"#155724" },
  },
  "MILA Lounge": {
    Diamond:  { tables: new Set(["305","306","307","405","406","407","408","409"]),                            minPerTable: 2000, color:"#b9f2ff", textColor:"#0a4a6e" },
    Prestige: { tables: new Set(["403","404"]),                                                                minPerTable: 3000, color:"#e8d5ff", textColor:"#4a0080" },
    Gold:     { tables: new Set(["301","302","303","304","308","401","402","410"]),                            minPerTable: 1000, color:"#fff3cd", textColor:"#7d5a00" },
  },
  "Casa Neos Lounge": {
    Diamond:  { tables: new Set(["902","903","904","905","808","809"]),                                                minPerTable: 2000, color:"#b9f2ff", textColor:"#0a4a6e" },
    Platinum: { tables: new Set(["810","901","906","907","908","909","910","911","912","807"]),                        minPerTable: 1500, color:"#e8e8e8", textColor:"#2d2d2d" },
    Gold:     { tables: new Set(["803","804","805","806"]),                                                            minPerTable: 1000, color:"#fff3cd", textColor:"#7d5a00" },
  },
};

async function getBreakdown(token, venueName, guid, date) {
  const cfg     = BS_CONFIG[venueName];
  const tierMap = TIER_MAPS[venueName];
  const hdrs    = { Authorization: `Bearer ${token}`, "Toast-Restaurant-External-ID": guid };

  // Get table name map
  const tc = await axios.get(`${TOAST_BASE}/config/v2/tables`, { headers: hdrs });
  const tablesCfg = Array.isArray(tc.data) ? tc.data : (tc.data?.tables || tc.data?.results || []);
  const nameToGuid = {}, guidToName = {};
  for (const t of tablesCfg) {
    const n = (t.name ?? t.tableName ?? t.externalId ?? "").trim();
    if (n && t.guid) { nameToGuid[n] = t.guid; guidToName[t.guid] = n; }
  }

  // Build BS GUID set from all tier tables
  const allBsTables = new Set(Object.values(tierMap).flatMap(t => [...t.tables]));
  const bsGuids = new Set();
  for (const [n, g] of Object.entries(nameToGuid)) {
    if (allBsTables.has(n) || allBsTables.has(n.toUpperCase()) || allBsTables.has(n.toLowerCase())) bsGuids.add(g);
  }

  // Fetch all orders
  const allOrders = [];
  for (let p = 1; p <= 20; p++) {
    const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk`, {
      headers: hdrs,
      params: { businessDate: date.replace(/-/g, ""), pageSize: 100, page: p },
    });
    const batch = Array.isArray(r.data) ? r.data : Object.values(r.data);
    allOrders.push(...batch);
    if (batch.length < 100) break;
  }

  const byTable = {};
  const isSun = new Date(date + "T12:00:00Z").getUTCDay() === 0;
  const startFrac = (isSun && cfg.sundayStartFrac != null) ? cfg.sundayStartFrac : cfg.startFrac;

  for (const o of allOrders) {
    const hasTable = !!(o.table?.guid);
    const isBs     = bsGuids.has(o.table?.guid ?? "");
    if (!isBs && !(cfg.includeNoTable && !hasTable)) continue;

    const dt   = new Date(new Date(o.openedDate).getTime() - 4 * 3600000);
    const frac = (dt.getUTCHours() * 60 + dt.getUTCMinutes()) / 1440;
    const inW  = cfg.crossesMidnight ? (frac >= startFrac || frac <= cfg.endFrac) : (frac >= startFrac && frac <= cfg.endFrac);
    if (!inW) continue;

    const tname = hasTable ? (guidToName[o.table.guid] ?? o.table.guid) : "No Table";
    if (!byTable[tname]) byTable[tname] = { total: 0, checks: 0 };
    for (const c of (o.checks || [])) {
      if (c.voided) continue;
      const amt = (c.selections || []).filter(s => !s.voided).reduce((s, sel) => s + (sel.price || 0), 0);
      if (!amt) continue;
      byTable[tname].total  += amt;
      byTable[tname].checks += 1;
    }
  }
  for (const k of Object.keys(byTable)) byTable[k].total = Math.round(byTable[k].total * 100) / 100;

  // Build tier summary
  const tiers = {};
  for (const [tierName, tierCfg] of Object.entries(tierMap)) {
    const tierTables = [...tierCfg.tables];
    const sold       = tierTables.filter(t => (byTable[t]?.total ?? 0) > 0);
    const totalSales = tierTables.reduce((s, t) => s + (byTable[t]?.total ?? 0), 0);
    tiers[tierName]  = {
      soldTables:  sold.length,
      totalTables: tierTables.length,
      totalSales:  Math.round(totalSales),
      avgPerTable: sold.length ? Math.round(totalSales / sold.length) : 0,
      minPerTable: tierCfg.minPerTable,
      color:       tierCfg.color,
      textColor:   tierCfg.textColor,
    };
  }

  // Build tableDetail
  const findTier = t => { for (const [tn, tc] of Object.entries(tierMap)) if (tc.tables.has(t)) return tn; return "Other"; };
  const allSold = new Set([...Object.keys(byTable).filter(t => byTable[t].total > 0)]);
  for (const tc of Object.values(tierMap)) for (const t of tc.tables) allSold.add(t);
  const tableDetail = [...allSold].map(t => ({
    table:       t,
    tier:        findTier(t),
    sales:       Math.round(byTable[t]?.total ?? 0),
    checks:      byTable[t]?.checks ?? 0,
    minPerTable: tierMap[findTier(t)]?.minPerTable ?? 0,
  })).sort((a, b) => b.sales - a.sales);

  const tablesActual = tableDetail.filter(t => t.tier !== "Other" && t.sales > 0).length;
  const tablesBudget = Object.values(tierMap).reduce((s, tc) => s + tc.tables.size, 0);
  const totalSales   = Math.round(Object.values(byTable).reduce((s, v) => s + v.total, 0));

  return { tiers, tableDetail, tablesActual, tablesBudget, totalSales };
}

// Load SCHED to get fees, bsMin, etc.
const html  = fs.readFileSync("C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html", "latin1");
const schedM = html.match(/var SCHED = (\[[\s\S]*?\]);/);
const SCHED  = eval(schedM[1]);

const SHOWS = [
  { venue: "Casa Neos Beach Club", date: "2026-07-11", dj: "BARUT" },
  { venue: "Casa Neos Beach Club", date: "2026-07-12", dj: "JOEZI" },
  { venue: "MILA Lounge",          date: "2026-07-08", dj: "LEX" },
  { venue: "MILA Lounge",          date: "2026-07-09", dj: "SPARROW" },
  { venue: "MILA Lounge",          date: "2026-07-10", dj: "ENOO NAPA" },
  { venue: "MILA Lounge",          date: "2026-07-11", dj: "SAMANTHA LOVERIDGE" },
  { venue: "Casa Neos Lounge",     date: "2026-07-09", dj: "BARUT" },
  { venue: "Casa Neos Lounge",     date: "2026-07-10", dj: "JENIA TERSOL b2b ECHONOMIST" },
  { venue: "Casa Neos Lounge",     date: "2026-07-11", dj: "ONOMA or BIRDS OF MIND" },
  { venue: "Casa Neos Lounge",     date: "2026-07-12", dj: "AFTERDARK" },
];
for (const show of SHOWS) {
  const s = SCHED.find(r => r.d === show.date && (r.venue === show.venue || r.v === show.venue));
  if (s) { show.fee = s.fee || s.cost || 0; show.bsMin = s.bs_m || 0; show.bsA = s.bs_a || 0; show.roi_t = s.roi_t || 0; show.roi_a = s.roi_a || 0; }
}

console.error("Getting Toast token...");
const token = await getToken();
console.error("Token OK. Fetching", SHOWS.length, "shows...");

const weekKey = "2026-W28";
const weekOf  = "Jul 6 \u2013 Jul 12, 2026";
const dateOpts = { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" };

const results = {};
for (const show of SHOWS) {
  const guid = VENUE_GUIDS[show.venue];
  console.error(`  ${show.venue} ${show.date} ${show.dj}...`);
  try {
    const bd = await getBreakdown(token, show.venue, guid, show.date);
    if (!results[show.venue]) results[show.venue] = { venue: show.venue, weekOf, weekKey, shows: [] };
    results[show.venue].shows.push({
      date:         show.date,
      label:        new Date(show.date + "T12:00:00Z").toLocaleDateString("en-US", dateOpts),
      dj:           show.dj,
      fee:          show.fee || 0,
      bsActual:     show.bsA || bd.totalSales,
      bsMin:        show.bsMin || 0,
      tablesActual: bd.tablesActual,
      tablesBudget: bd.tablesBudget,
      tiers:        bd.tiers,
      tableDetail:  bd.tableDetail,
      roiActual:    show.roi_a || 0,
      roiTarget:    show.roi_t || 0,
    });
    console.error(`    -> $${bd.totalSales.toLocaleString()}, ${bd.tablesActual} tables sold`);
  } catch(e) {
    console.error(`    ERROR: ${e.message}`);
  }
}

const order  = ["Casa Neos Beach Club", "MILA Lounge", "Casa Neos Lounge"];
const vipArr = order.map(vn => results[vn]).filter(Boolean);
const outPath = "C:\\Cursor\\toast-mcp-server\\fetch-lw-clean.json";
fs.writeFileSync(outPath, JSON.stringify(vipArr, null, 2), "utf8");
console.error("Written to", outPath);
