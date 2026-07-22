/**
 * Shared Toast LIVE pull — used by night script (legacy), Live Refresh HTTP, and GitHub Actions.
 * Writes Firebase rdg/liveNight only (never patches SCHED / git).
 */
'use strict';

const axios = require('axios');
const https = require('https');
const fs = require('fs');

const TOAST_BASE = 'https://ws-api.toasttab.com';
const FB_DB = 'rdg-dj-dashboard-default-rtdb.firebaseio.com';

const CLIENT_ID = process.env.TOAST_CLIENT_ID || 'jsS6dB6QotBhmPsOAyBTfl0jFyhAE9ZC';
const API_SECRET = process.env.TOAST_API_SECRET || 'nyUrcOs_cG4V4YN5f82Z-3esSdg_-mtw7BgtFi59MIypXpuRsquUqOSkHMYy8MA9';
const DASHBOARD = process.env.DASHBOARD_PATH ||
  'C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html';

const VENUES = {
  casa_neos: 'c3f36849-5105-44ab-9168-62be1f89a59e',
  mm_mila: '618a14f3-35d0-4491-9738-92f01c9651b7',
  casa_neos_lounge: 'f1f95f8b-80b9-42de-a8ba-47a5fb8aac70',
};

const BS_CONFIG = {
  casa_neos: {
    label: 'Casa Neos Beach Club',
    days: [6, 0],
    tables: new Set(['34','51','52','31','41','32','33','35','36','42','43','46','48','49',
      '53','54','55','56','45','44','47','24','25','26','27','28','19','20',
      '21','22','23','C1','C2','C3','C4','C5','C6','C7','C8','C9','C10',
      'C1A','C2A','C3A','C4A','C5A','C6A','C7A','C8A','C9A','C10A',
      'D1','D2','D3','D4','D5','D6','D7']),
    startFrac: 0.604167, endFrac: 0.833333, crossesMidnight: false,
  },
  mm_mila: {
    label: 'MILA Lounge',
    days: [3, 4, 5, 6],
    tables: new Set(['402','304','303','302','301','308','410','401','403','404','305','306',
      '307','408','408bis','407','405','409','406','1','2','3','4','5','6','7',
      '8','9','10','11','12','1A','2A','3A','4A','5A','6A','7A','8A','9A',
      '10A','11A','12A','S1','S2','S3','S4','S5','S6','S7','S8','S9','S10',
      'S11','S12','S13','S14','S15','S16','S17','S18','S19','S20','S21',
      'S22','S23','S24','S25','S26','S27','S28','S29','S30','73']),
    startFrac: 0.979167, endFrac: 0.208333, crossesMidnight: true,
  },
  casa_neos_lounge: {
    label: 'Casa Neos Lounge',
    days: [4, 5, 6, 0],
    tables: new Set(['809','808','905','904','903','902','810','906','907','908','909','910',
      '911','912','901','807','806','805','804','803','L1','L2','L3','L4',
      'L5','L6','L7','L8','L9','L10','L11','L12','L1A','L2A','L3A','L4A',
      'L5A','L6A','L7A','L8A','L9A','L10A','L11A','L12A','44']),
    startFrac: 0.958333, endFrac: 0.208333, crossesMidnight: true,
    includeNoTable: true, sundayStartFrac: 0.75,
  },
};

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('en-US', { hour12: false })}] ${msg}`);
}

function miamiParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = {};
  fmt.formatToParts(d).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    dateStr: `${parts.year}-${parts.month}-${parts.day}`
  };
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function liveBusinessDate(parts) {
  // After midnight until 5am still belongs to last night's show (matches dashboard)
  if (parts.hour < 5) return shiftDate(parts.dateStr, -1);
  return parts.dateStr;
}

function inLiveWindow(parts) {
  return parts.hour >= 23 || parts.hour < 5;
}

function isOperatingDay(venueKey, dateStr) {
  const cfg = BS_CONFIG[venueKey];
  if (!cfg || !cfg.days) return true;
  return cfg.days.includes(new Date(dateStr + 'T12:00:00').getDay());
}

function fbPut(fbPath, payload) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: FB_DB, path: fbPath + '.json', method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(r.statusCode)); });
    req.on('error', rej); req.write(body); req.end();
  });
}

async function getToken() {
  const res = await axios.post(`${TOAST_BASE}/authentication/v1/authentication/login`, {
    clientId: CLIENT_ID, clientSecret: API_SECRET, userAccessType: 'TOAST_MACHINE_CLIENT',
  });
  return res.data.token.accessToken;
}

async function getTableGuids(token, venueGuid, bsNames) {
  const res = await axios.get(`${TOAST_BASE}/config/v2/tables`, {
    headers: { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': venueGuid },
  });
  const tables = Array.isArray(res.data) ? res.data : (res.data?.tables || []);
  const guids = new Set();
  for (const t of tables) {
    const name = (t.name ?? t.tableName ?? '').trim();
    if (t.guid && (bsNames.has(name) || bsNames.has(name.toUpperCase()) || bsNames.has(name.toLowerCase())))
      guids.add(t.guid);
  }
  return guids;
}

async function getAllOrders(token, venueGuid, date) {
  const businessDate = date.replace(/-/g, '');
  const headers = { Authorization: `Bearer ${token}`, 'Toast-Restaurant-External-ID': venueGuid };
  const all = [];
  // Larger pages = fewer round-trips (same orders, still complete)
  for (let page = 1; page <= 50; page++) {
    const res = await axios.get(
      `${TOAST_BASE}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=200&page=${page}`,
      { headers, timeout: 45000 }
    );
    const batch = Array.isArray(res.data) ? res.data : Object.values(res.data || {});
    all.push(...batch);
    if (batch.length < 200) break;
  }
  return all;
}

async function fetchBsForDate(venueKey, date, token, opts = {}) {
  const cfg = BS_CONFIG[venueKey];
  const guid = VENUES[venueKey];
  // On forced LIVE refresh always hit Toast (all locations, day-of).
  // Outside force, skip known dark nights to save API calls.
  if (!opts.force && !isOperatingDay(venueKey, date)) {
    return { total: 0, activeTables: 0, skipped: true };
  }
  const auth = token || await getToken();
  const [bsGuids, orders] = await Promise.all([
    getTableGuids(auth, guid, cfg.tables),
    getAllOrders(auth, guid, date)
  ]);
  let total = 0;
  const active = new Set();
  for (const order of orders) {
    const hasTable = !!(order.table?.guid);
    const isBsTable = bsGuids.has(order.table?.guid ?? '');
    if (!isBsTable && !(cfg.includeNoTable && !hasTable)) continue;
    const openedUtc = order.openedDate;
    if (!openedUtc) continue;
    const localMs = new Date(openedUtc).getTime() - 4 * 60 * 60 * 1000;
    const localDate = new Date(localMs);
    const timeFrac = (localDate.getUTCHours() * 60 + localDate.getUTCMinutes()) / 1440;
    const isSunday = new Date(date + 'T12:00:00Z').getUTCDay() === 0;
    const startFrac = (isSunday && cfg.sundayStartFrac !== undefined) ? cfg.sundayStartFrac : cfg.startFrac;
    const inWindow = cfg.crossesMidnight
      ? (timeFrac >= startFrac || timeFrac <= cfg.endFrac)
      : (timeFrac >= startFrac && timeFrac <= cfg.endFrac);
    if (!inWindow) continue;
    let orderAmt = 0;
    for (const check of (order.checks || [])) {
      if (check.voided) continue;
      orderAmt += (check.selections || []).filter(s => !s.voided).reduce((s, sel) => s + (sel.price || 0), 0);
    }
    if (orderAmt <= 0) continue;
    total += orderAmt;
    if (order.table?.guid) active.add(order.table.guid);
    else if (cfg.includeNoTable && !hasTable) active.add('no-table');
  }
  return { total: Math.round(total * 100) / 100, activeTables: active.size };
}

function loadSchedShows(dateStr) {
  if (!fs.existsSync(DASHBOARD)) return [];
  const html = fs.readFileSync(DASHBOARD, 'utf8');
  const start = html.indexOf('var SCHED = ');
  if (start < 0) return [];
  const arrStart = html.indexOf('[', start);
  let depth = 0, end = -1;
  for (let p = arrStart; p < html.length; p++) {
    const c = html[p];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = p; break; } }
  }
  const SCHED = JSON.parse(html.slice(arrStart, end + 1));
  return SCHED.filter(s => {
    if ((s.d || '') !== dateStr) return false;
    const dj = String(s.dj || '').replace(/\?+/g, '').trim();
    return !!dj && dj.toUpperCase() !== 'TBD';
  });
}

/**
 * Pull Toast LIVE for the current Miami business night and write Firebase.
 * @param {{ force?: boolean, trigger?: string }} opts
 */
async function pullToastLive(opts = {}) {
  const force = !!opts.force;
  const trigger = opts.trigger || 'manual';
  const parts = miamiParts();
  const active = inLiveWindow(parts);
  const bizDate = liveBusinessDate(parts);

  log(`=== Toast LIVE (${trigger}) === Miami ${parts.dateStr} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')} | bizDate=${bizDate} | window=${active} | force=${force}`);

  if (!active && !force) {
    return { skipped: true, reason: 'outside_window', bizDate, parts };
  }

  const venueKeys = ['casa_neos', 'mm_mila', 'casa_neos_lounge'];
  const sales = {};
  const stats = {};
  const errors = [];

  // One auth token + all three venues in parallel (much faster, same accuracy)
  const token = await getToken();
  const settled = await Promise.all(venueKeys.map(async (vk) => {
    try {
      const res = await fetchBsForDate(vk, bizDate, token, { force: force || active });
      log(`  ${BS_CONFIG[vk].label} ${bizDate} → $${(res.total || 0).toLocaleString()} · ${res.activeTables} active tables${res.skipped ? ' (dark night skip)' : ''}`);
      return { vk, ok: true, res };
    } catch (e) {
      log(`  ERROR ${vk}: ${e.message}`);
      return { vk, ok: false, error: e.message };
    }
  }));
  for (const row of settled) {
    if (row.ok) {
      sales[row.vk] = row.res.total;
      stats[row.vk] = { activeTables: row.res.activeTables };
    } else {
      sales[row.vk] = null;
      stats[row.vk] = { activeTables: 0 };
      errors.push({ venue: row.vk, message: row.error });
    }
  }

  const shows = loadSchedShows(bizDate);
  const rows = shows.map(s => {
    const venue = s.v || s.venue;
    const vk = venueKeys.find(k => BS_CONFIG[k].label === venue);
    const fee = s.fee != null ? s.fee : (s.cost != null ? s.cost : null);
    const bs_m = s.bs_m != null ? s.bs_m : null;
    const roi_t = s.roi_t != null ? s.roi_t : null;
    const bs_a = (vk && sales[vk] != null) ? sales[vk] : null;
    const activeTables = (vk && stats[vk]) ? stats[vk].activeTables : null;
    const roi_a = (fee > 0 && bs_a != null) ? Math.round((bs_a / fee) * 10000) / 10000 : null;
    return {
      venue, date: bizDate, dj: s.dj,
      fee, bs_m, roi_t, bs_a, roi_a, activeTables,
      beat: (bs_a != null && bs_m != null) ? (bs_a >= bs_m ? 1 : 0) : null
    };
  });

  const payload = {
    date: bizDate,
    updatedAt: new Date().toISOString(),
    updatedAtLocal: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    windowActive: active || force,
    trigger,
    salesByVenue: Object.fromEntries(venueKeys.map(vk => [BS_CONFIG[vk].label, sales[vk]])),
    statsByVenue: Object.fromEntries(venueKeys.map(vk => [BS_CONFIG[vk].label, stats[vk]])),
    rows
  };

  const st = await fbPut('/rdg/liveNight', payload);
  log(`Firebase liveNight → HTTP ${st} (${rows.length} shows)`);

  const ok = errors.length === 0 && st >= 200 && st < 300;
  const message = `LIVE ${bizDate} (${trigger}): ${rows.length} shows · ` +
    venueKeys.map(vk => `${BS_CONFIG[vk].label.split(' ').pop()} $${(sales[vk] || 0).toLocaleString()}`).join(' · ');

  await fbPut('/rdg/scrapeStatus/toastLive', {
    ok,
    at: payload.updatedAt,
    atLocal: payload.updatedAtLocal,
    message,
    schedule: 'On-demand only (Live Refresh button)',
    what: 'Toast bottle-service totals for tonight → Firebase liveNight',
    trigger,
    errors: errors.length ? errors : null
  });

  await fbPut('/rdg/liveRefreshRequest', {
    status: ok ? 'done' : 'failed',
    finishedAt: payload.updatedAt,
    bizDate,
    ok,
    message
  });

  return { skipped: false, ok, payload, errors, http: st };
}

module.exports = {
  pullToastLive,
  miamiParts,
  liveBusinessDate,
  inLiveWindow,
  BS_CONFIG,
  VENUES
};
