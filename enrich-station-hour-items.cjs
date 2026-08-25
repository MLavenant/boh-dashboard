'use strict';
/**
 * Fetch Toast item-details (lastWeek) and attach stationHourItems to venue week JSON.
 * Usage: node enrich-station-hour-items.cjs [venue_slug] [weekKey]
 * Example: node enrich-station-hour-items.cjs ava_coconut_grove 2026-W32
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ROOT = __dirname;
const SESSION_FILE = path.join(ROOT, 'toast-session.json');
const MAP_FILE = path.join(ROOT, 'item-station-map.json');
const TOAST_ADMIN = 'https://www.toasttab.com';

const KITCHEN_GROUP_IDS = {
  claudie: '500000037853698711',
  ava_coconut_grove: '500000056033936853',
  ava_winter_park: '500000013674501001',
  casa_neos: '500000037911188149',
  mila: '500000000001501691',
};

const VENUE_MAP_KEY = {
  claudie: 'claudie',
  casa_neos: 'casa_neos',
  ava_coconut_grove: 'ava_cg',
  ava_winter_park: 'ava_wp',
  mila: 'mila',
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EXCLUDE_WORDS = [
  'bar', 'champagne', 'wine', 'btg', 'pos', 'barista', 'somm', 'water', 'service', 'beach', 'drink',
  'no print', 'noprint', 'all in', 'package', 'deposit', 'beo', 'gift card', 'gratuity',
  'host', 'runner', 'server', 'captain', 'busser', 'bartender', 'sommelier',
];
const BEVERAGE_KEYWORDS = [
  'evian', 'pellegrino', 'perrier', 'water', 'coke', 'coca', 'diet', 'sprite', 'soda', 'juice',
  'lemonade', 'iced tea', 'ginger ale', 'still', 'sparkling', 'beer', 'wine', 'champagne',
  'prosecco', 'vodka', 'gin', 'rum', 'tequila', 'whiskey', 'whisky', 'bourbon', 'espresso',
  'coffee', 'latte', 'cappuccino', 'tea', 'barista', 'americano', 'cocktail', 'martini',
];

function isFood(name) {
  if (!name) return false;
  const low = name.toLowerCase();
  return !EXCLUDE_WORDS.some((w) => low.includes(w));
}
function isExcludedMenuItem(name) {
  if (!name) return true;
  const n = name.toLowerCase();
  if (BEVERAGE_KEYWORDS.some((kw) => n.includes(kw))) return true;
  if (/^MB[\s_-]/i.test(String(name).trim())) return true;
  if (/deposit|beo|gratuity|gift card/i.test(name)) return true;
  return false;
}
function stripName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function parseDate(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) {
    const d = new Date(str);
    return isNaN(d) ? null : d;
  }
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  let hour = parseInt(m[4], 10);
  const min = parseInt(m[5], 10);
  const ap = (m[6] || '').toUpperCase();
  if (ap === 'PM' && hour < 12) hour += 12;
  if (ap === 'AM' && hour === 12) hour = 0;
  return new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10), hour, min);
}
function fmtWhen(d) {
  const day = DAYS[d.getDay()].slice(0, 3);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'p' : 'a';
  h = h % 12;
  if (h === 0) h = 12;
  return `${day} ${h}:${m}${ap}`;
}
function parseCSV(csvText) {
  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = [];
    let cur = '';
    let inQ = false;
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        if (inQ && line[j + 1] === '"') {
          cur += '"';
          j++;
        } else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        cols.push(cur);
        cur = '';
      } else cur += ch;
    }
    cols.push(cur);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] || '').replace(/^"|"$/g, '');
    });
    rows.push(obj);
  }
  return rows;
}

function getSessionCookies() {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  return (session.cookies || []).map((c) => `${c.name}=${c.value}`).join('; ');
}

async function fetchItemDetails(venueKey) {
  const cookies = getSessionCookies();
  const headers = {
    Cookie: cookies,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: '*/*',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: 'https://www.toasttab.com/restaurants/admin/reports/home',
  };
  const groupId = KITCHEN_GROUP_IDS[venueKey];
  let qs = 'excel=true&reportDateRange=lastWeek&numberOfRestaurants=1';
  if (groupId) qs += `&reportGroupIds=${groupId}`;
  const triggerRes = await axios.get(`${TOAST_ADMIN}/restaurants/admin/reports/menu/toplevelitemselections?${qs}`, {
    headers,
    validateStatus: () => true,
  });
  const s3Url = triggerRes.headers.location || triggerRes.headers.Location;
  if (!s3Url) throw new Error(`No S3 URL (status ${triggerRes.status})`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const s3Res = await axios.get(s3Url, { validateStatus: () => true });
    const d = s3Res.data;
    if (d.downloadUrl) {
      const csvRes = await axios.get(d.downloadUrl, { responseType: 'arraybuffer', validateStatus: () => true });
      const csvText = Buffer.from(csvRes.data).toString('latin1');
      const rows = parseCSV(csvText);
      return rows
        .filter((r) => r['Void?'] !== 'true')
        .map((r) => ({
          sentDate: r['Sent Date'] || '',
          menuItem: r['Menu Item'] || '',
          table: r['Table'] || '',
          server: r['Server'] || '',
          qty: parseFloat(r['Qty']) || 1,
        }));
    }
    if (d.status === 'ERROR' || d.status === 'FAILED') throw new Error(d.message || 'report failed');
  }
  throw new Error('item-details timed out');
}

function resolveAssignedStation(menuItem, assignments, stationKeys) {
  let info = assignments[menuItem];
  if (!info) {
    const want = stripName(menuItem);
    const hit = Object.keys(assignments).find((k) => stripName(k) === want);
    if (hit) info = assignments[hit];
  }
  if (!info || !Array.isArray(info.stations)) return null;
  const ranked = info.stations.filter((st) => st && isFood(st) && !/no\s*print/i.test(st));
  const cookFirst = ranked.find((st) => !/expo|pass/i.test(st));
  let assigned = cookFirst || ranked[0] || null;
  if (!assigned) return null;
  if (stationKeys.has(assigned)) return assigned;
  const want = stripName(assigned);
  let best = null;
  let bestLen = 0;
  for (const k of stationKeys) {
    const kn = stripName(k);
    if (kn === want) return k;
    if ((kn.includes(want) || want.includes(kn)) && Math.min(kn.length, want.length) > bestLen) {
      best = k;
      bestLen = Math.min(kn.length, want.length);
    }
  }
  return best;
}

function buildStationHourItems(items, assignments, stationKeys) {
  const out = {}; // station -> day -> hour -> events[]
  let kept = 0;
  let skipped = 0;
  items.forEach((item) => {
    if (!item.menuItem || isExcludedMenuItem(item.menuItem)) {
      skipped += item.qty || 1;
      return;
    }
    const fired = parseDate(item.sentDate);
    if (!fired) {
      skipped += item.qty || 1;
      return;
    }
    const station = resolveAssignedStation(item.menuItem, assignments, stationKeys);
    if (!station) {
      skipped += item.qty || 1;
      return;
    }
    const day = DAYS[fired.getDay()];
    const hr = fired.getHours();
    const hrKey = `${hr}-${hr + 1}`;
    const qty = item.qty || 1;
    const info = assignments[item.menuItem] || assignments[Object.keys(assignments).find((k) => stripName(k) === stripName(item.menuItem))] || {};
    const hasTarget = !!(info && info.targetSec > 0);
    if (!out[station]) out[station] = {};
    if (!out[station][day]) out[station][day] = {};
    if (!out[station][day][hrKey]) out[station][day][hrKey] = [];
    out[station][day][hrKey].push({
      n: item.menuItem,
      q: qty,
      t: fmtWhen(fired),
      ts: fired.toISOString(),
      tgt: hasTarget ? 1 : 0,
      table: item.table || '',
    });
    kept += qty;
  });
  // Sort each bucket by time, then drop ISO ts to shrink payload
  Object.values(out).forEach((days) => {
    Object.values(days).forEach((hours) => {
      Object.keys(hours).forEach((hk) => {
        hours[hk].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
        hours[hk].forEach((e) => { delete e.ts; });
      });
    });
  });
  return { out, kept, skipped };
}

function patchItemQty(stationDetails, stationHourItems) {
  Object.keys(stationHourItems || {}).forEach((st) => {
    if (!stationDetails[st]) stationDetails[st] = { byDayHour: {}, hourly: {}, breakingHours: [] };
    if (!stationDetails[st].byDayHour) stationDetails[st].byDayHour = {};
    Object.entries(stationHourItems[st]).forEach(([day, hours]) => {
      if (!stationDetails[st].byDayHour[day]) stationDetails[st].byDayHour[day] = {};
      Object.entries(hours).forEach(([hk, events]) => {
        const itemQty = events.reduce((a, e) => a + (e.q || 1), 0);
        const cell = stationDetails[st].byDayHour[day][hk] || { count: 0, avg_sec: 0, exp_sec: 0 };
        cell.itemQty = itemQty;
        stationDetails[st].byDayHour[day][hk] = cell;
      });
    });
  });
}

async function main() {
  const venue = process.argv[2] || 'ava_coconut_grove';
  let weekKey = process.argv[3];
  if (!weekKey) {
    const weeks = fs.readdirSync(path.join(ROOT, 'data'))
      .filter((d) => /^\d{4}-W\d{2}$/.test(d))
      .sort();
    weekKey = weeks[weeks.length - 1] || '2026-W34';
  }
  const weekPath = path.join(ROOT, `${venue}-data-${weekKey}.json`);
  if (!fs.existsSync(weekPath)) throw new Error('Missing ' + weekPath);

  // Prefer on-disk item-details for this week (exact week); fall back to Toast lastWeek export
  const localItemsPath = path.join(ROOT, 'data', weekKey, `item-details-${venue}.json`);
  let items;
  if (fs.existsSync(localItemsPath)) {
    const raw = JSON.parse(fs.readFileSync(localItemsPath, 'utf8'));
    items = raw.items || raw;
    console.log(`Using local item-details ${localItemsPath} (${items.length} rows)`);
  } else {
    console.log(`Fetching item-details lastWeek for ${venue}...`);
    items = await fetchItemDetails(venue);
    console.log(`Got ${items.length} item rows`);
  }

  const week = JSON.parse(fs.readFileSync(weekPath, 'utf8'));
  const stationKeys = new Set(Object.keys(week.stationDetails || {}));
  const allMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  const assignments = allMap[VENUE_MAP_KEY[venue] || venue] || {};

  const { out, kept, skipped } = buildStationHourItems(items, assignments, stationKeys);
  patchItemQty(week.stationDetails, out);
  week.stationHourItems = out;
  week.stationHourItemsMeta = {
    builtAt: new Date().toISOString(),
    source: 'item-details lastWeek',
    weekKey,
    itemRows: items.length,
    qtyKept: kept,
    qtySkipped: skipped,
  };

  fs.writeFileSync(weekPath, JSON.stringify(week));
  const pastry = (out.Pastry && Object.values(out.Pastry).reduce((n, hours) => {
    Object.values(hours).forEach((ev) => { n += ev.reduce((a, e) => a + e.q, 0); });
    return n;
  }, 0)) || 0;
  console.log(`Patched ${weekPath}`);
  console.log(`qty kept=${kept} skipped=${skipped}; Pastry listed qty=${pastry}; stations=${Object.keys(out).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
