'use strict';
const fs = require('fs');
const path = require('path');

const venueArg = process.argv[2];
if (!venueArg) { console.error('Usage: node process-venue-data.cjs <venue_slug>'); process.exit(1); }

// Load authoritative item assignments + targets (REF, then chef overrides).
let ITEM_ASSIGNMENTS = {};
try {
  const mapPath = path.join(__dirname, 'item-station-map.json');
  const allAssignments = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const keyMap = { claudie: 'claudie', casa_neos: 'casa_neos', casaneos: 'casa_neos', ava_coconut_grove: 'ava_cg', ava_winter_park: 'ava_wp', mila: 'mila' };
  const configKey = keyMap[venueArg] || venueArg;
  ITEM_ASSIGNMENTS = allAssignments[configKey] || {};
} catch(e) { /* item assignment file optional */ }

// Use explicit week arg (e.g. 2026-W28) or auto-detect latest week directory
const weekArg = process.argv[3];
let weekDir;
if (weekArg) {
  weekDir = weekArg;
} else {
  const dataRoot = path.join(__dirname, 'data');
  const entries = fs.readdirSync(dataRoot)
    .filter(d => /^\d{4}-W\d{2}$/.test(d))
    .sort();
  if (!entries.length) { console.error('No week directories found in data/'); process.exit(1); }
  weekDir = entries[entries.length - 1];
  console.log(`Auto-detected week: ${weekDir}`);
}
const DATA_DIR = path.join(__dirname, 'data', weekDir);
const ktPath = path.join(DATA_DIR, `kitchen-timing-${venueArg}.json`);
const coversPath = path.join(DATA_DIR, `covers-${venueArg}.json`);

const ktRaw = JSON.parse(fs.readFileSync(ktPath, 'utf8'));
const coversRaw = JSON.parse(fs.readFileSync(coversPath, 'utf8'));

const tickets = ktRaw.tickets || ktRaw;
const covers = coversRaw.covers || coversRaw;

// Load item details if available
const itemDetailsPath = path.join(DATA_DIR, `item-details-${venueArg}.json`);
let itemDetails = [];
if (fs.existsSync(itemDetailsPath)) {
  try {
    const idRaw = JSON.parse(fs.readFileSync(itemDetailsPath, 'utf8'));
    itemDetails = idRaw.items || [];
    console.log(`Item details for ${venueArg}: ${itemDetails.length} rows`);
  } catch(e) { console.warn('Could not load item details:', e.message); }
} else {
  console.log(`No item-details-${venueArg}.json found, skipping menu item volumes`);
}

// ---- Station filter ----
const EXCLUDE_WORDS = ['bar','champagne','wine','btg','pos','barista','somm','water','service','beach','drink'];
function isFood(name) {
  if (!name) return false;
  const low = name.toLowerCase();
  return !EXCLUDE_WORDS.some(w => low.includes(w));
}

// ---- Parse fulfillment time ----
function parseFulTime(str) {
  if (!str) return null;
  const mMatch = str.match(/(\d+)\s*minute/);
  const sMatch = str.match(/(\d+)\s*second/);
  const m = mMatch ? parseInt(mMatch[1]) : 0;
  const s = sMatch ? parseInt(sMatch[1]) : 0;
  return m * 60 + s;
}

// ---- Parse date string from ticket ----
function parseDate(str) {
  if (!str) return null;
  // Format: "6/29/26 5:48 PM"
  try {
    const d = new Date(str.replace(/(\d+)\/(\d+)\/(\d+)/, (_, m, d, y) => `20${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`));
    return isNaN(d) ? null : d;
  } catch(e) { return null; }
}

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ---- Filter food tickets ----
const foodTickets = tickets.filter(t => isFood(t['Station'])).map(t => {
  const fired = parseDate(t['Fired Date']);
  const fulSec = parseFulTime(t['Fulfillment Time']);
  const fulfilled = fired && fulSec != null ? new Date(fired.getTime() + fulSec * 1000) : null;
  return { ...t, _fired: fired, _fulfilled: fulfilled, _fulSec: fulSec };
}).filter(t => t._fired && t._fulSec != null);

console.log(`Food tickets for ${venueArg}: ${foodTickets.length}`);

// ---- workloadDayHourly ----
// For each ticket, assign to day+hour of the fired date
const dayHourMap = {}; // {day: {hr: {sumFul, count}}}
foodTickets.forEach(t => {
  const day = DAYS[t._fired.getDay()];
  const hr = t._fired.getHours();
  const hrKey = `${hr}-${hr+1}`;
  if (!dayHourMap[day]) dayHourMap[day] = {};
  if (!dayHourMap[day][hrKey]) dayHourMap[day][hrKey] = { sumFul: 0, count: 0 };
  dayHourMap[day][hrKey].sumFul += t._fulSec / 60;
  dayHourMap[day][hrKey].count++;
});

const workloadDayHourly = [];
Object.keys(dayHourMap).forEach(day => {
  Object.keys(dayHourMap[day]).forEach(hrKey => {
    const d = dayHourMap[day][hrKey];
    workloadDayHourly.push({
      Day: day,
      'Hour Window': hrKey,
      avg_fulfillment_min: +(d.sumFul / d.count).toFixed(2),
      occurrences: d.count,
    });
  });
});

// Build hmFul for dashboard
const hmFul = {};
workloadDayHourly.forEach(r => {
  if (!hmFul[r.Day]) hmFul[r.Day] = {};
  hmFul[r.Day][r['Hour Window']] = r.avg_fulfillment_min;
});

// Hour-of-day profile (10am → 4am): avg occurrences + avg fulfillment across days
const SERVICE_HOURS = [10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3];
const hourProfile = SERVICE_HOURS.map(hr => {
  const hrKey = `${hr}-${hr + 1}`;
  let sumOcc = 0, sumFulWeighted = 0, daysWithData = 0;
  Object.keys(dayHourMap).forEach(day => {
    const cell = dayHourMap[day][hrKey];
    if (!cell || !cell.count) return;
    sumOcc += cell.count;
    sumFulWeighted += cell.sumFul; // already in minutes * count
    daysWithData++;
  });
  return {
    hour: hrKey,
    label: hr === 0 ? '12a' : hr < 12 ? hr + 'a' : hr === 12 ? '12p' : (hr - 12) + 'p',
    avgOcc: daysWithData ? +(sumOcc / daysWithData).toFixed(1) : 0,
    avgFulMin: sumOcc ? +(sumFulWeighted / sumOcc).toFixed(2) : null,
    days: daysWithData,
    totalOcc: sumOcc,
  };
});

// ---- covers -> concurrent guests per minute ----
// Parse covers
const parsedCovers = covers.map(c => ({
  seated: new Date(c.seatedTime),
  finished: new Date(c.finishedTime),
  size: c.partySize || 1,
})).filter(c => {
  if (isNaN(c.seated) || isNaN(c.finished)) return false;
  const dur = c.finished - c.seated;
  return dur > 0 && dur < 12 * 3600 * 1000; // max 12-hour stay
});

function concurrentGuestsAt(ts) {
  return parsedCovers.filter(c => c.seated <= ts && c.finished >= ts).reduce((s, c) => s + c.size, 0);
}

// ---- otDayHourly ----
// For each day+hour bucket, compute avg concurrent guests (sample at half-hour mark)
const otDayHourlyMap = {};
parsedCovers.forEach(c => {
  // scan hour buckets that overlap with this cover
  const startHr = Math.floor(c.seated.getTime() / 3600000) * 3600000;
  const endHr = Math.floor(c.finished.getTime() / 3600000) * 3600000;
  for (let t = startHr; t <= endHr; t += 3600000) {
    const dt = new Date(t);
    const day = DAYS[dt.getDay()];
    const hr = dt.getHours();
    const hrKey = `${hr}-${hr+1}`;
    const key = `${day}|${hrKey}`;
    if (!otDayHourlyMap[key]) otDayHourlyMap[key] = { day, hrKey, samples: [] };
  }
});
// Now sample concurrent guests at each hour bucket midpoint
const uniqueHourBuckets = new Set();
parsedCovers.forEach(c => {
  const startHr = Math.floor(c.seated.getTime() / 3600000);
  const endHr = Math.floor(c.finished.getTime() / 3600000);
  for (let h = startHr; h <= endHr; h++) {
    uniqueHourBuckets.add(h);
  }
});

const hmGuests = {};
uniqueHourBuckets.forEach(h => {
  const midTs = new Date((h * 3600 + 1800) * 1000);
  const concurrent = concurrentGuestsAt(midTs);
  if (concurrent === 0) return;
  const day = DAYS[midTs.getDay()];
  const hr = midTs.getHours();
  const hrKey = `${hr}-${hr+1}`;
  if (!hmGuests[day]) hmGuests[day] = {};
  if (!hmGuests[day][hrKey]) hmGuests[day][hrKey] = { sum: 0, count: 0 };
  hmGuests[day][hrKey].sum += concurrent;
  hmGuests[day][hrKey].count++;
});
// Flatten
const hmGuestsFlat = {};
Object.keys(hmGuests).forEach(day => {
  hmGuestsFlat[day] = {};
  Object.keys(hmGuests[day]).forEach(hr => {
    const d = hmGuests[day][hr];
    hmGuestsFlat[day][hr] = +(d.sum / d.count).toFixed(1);
  });
});

// ---- workloadOverall using event-based intervals (matches Python algorithm) ----
// Step 1: Deduplicate foodTickets by (Check #, Fired Date, Fulfillment Time)
// A ticket with N stations generates N rows — collapse to 1 logical ticket.
const seenKeys = new Set();
const uniqueTickets = foodTickets.filter(t => {
  const key = `${t['Check #']}||${t['Fired Date']}||${t['Fulfillment Time']}`;
  if (seenKeys.has(key)) return false;
  seenKeys.add(key);
  return true;
});
console.log(`Unique tickets (deduped): ${uniqueTickets.length}`);

// Step 2: Build duration-weighted interval curve
function buildIntervalCurve(ticketList) {
  const events = [];
  ticketList.forEach(t => {
    events.push({ time: t._fired.getTime(), type: 1, ticket: t });
    events.push({ time: t._fulfilled.getTime(), type: -1, ticket: t });
  });
  // sort: earlier first; on tie, closes before opens to avoid momentary phantom overlap
  events.sort((a, b) => a.time !== b.time ? a.time - b.time : a.type - b.type);

  const open = new Set();
  let prevTime = null;
  const intervals = [];

  events.forEach(ev => {
    if (prevTime !== null && ev.time > prevTime && open.size > 0) {
      const duration_sec = (ev.time - prevTime) / 1000;
      const fuls = [...open].map(t => t._fulSec);
      const avg_ful_sec = fuls.reduce((s, x) => s + x, 0) / fuls.length;
      const midTs = new Date((prevTime + ev.time) / 2);
      const guests = concurrentGuestsAt(midTs);
      intervals.push({ conc: open.size, duration_sec, avg_ful_sec, guests });
    }
    if (ev.type === 1) open.add(ev.ticket);
    else open.delete(ev.ticket);
    prevTime = ev.time;
  });

  // Group intervals by concurrent count
  const byConc = {};
  intervals.forEach(iv => {
    if (!byConc[iv.conc]) byConc[iv.conc] = [];
    byConc[iv.conc].push(iv);
  });

  return Object.entries(byConc).map(([k, ivs]) => {
    const totalDur = ivs.reduce((s, iv) => s + iv.duration_sec, 0);
    const ful_min = ivs.reduce((s, iv) => s + (iv.avg_ful_sec / 60) * iv.duration_sec, 0) / totalDur;
    const sorted = [...ivs].sort((a, b) => a.avg_ful_sec - b.avg_ful_sec);
    const p75idx = Math.min(Math.floor(sorted.length * 0.75), sorted.length - 1);
    const p75_min = sorted[p75idx].avg_ful_sec / 60;
    const guestSum = ivs.reduce((s, iv) => s + iv.guests * iv.duration_sec, 0);
    const guests = totalDur > 0 ? guestSum / totalDur : 0;
    return {
      conc: +k,
      occ: ivs.length,
      ful: +ful_min.toFixed(2),
      p75: +p75_min.toFixed(2),
      guests: +guests.toFixed(1),
    };
  }).sort((a, b) => a.conc - b.conc);
}

const curve = buildIntervalCurve(uniqueTickets);

// tbk: bucket curve by 10 concurrent tickets, weighted by duration (occ × ful proxy)
const tbkMap = {};
curve.forEach(r => {
  const bucket = Math.floor(r.conc / 10) * 10;
  const label = `${bucket}-${bucket+10}`;
  if (!tbkMap[label]) tbkMap[label] = { sumFul: 0, sumOcc: 0, low: bucket };
  tbkMap[label].sumFul += r.ful * r.occ;
  tbkMap[label].sumOcc += r.occ;
});
const tbk = Object.entries(tbkMap).sort((a,b) => a[1].low - b[1].low).map(([label, d]) => ({
  bucket: label,
  ful: d.sumOcc > 0 ? +(d.sumFul / d.sumOcc).toFixed(2) : 0,
}));

// Breaking point — skip first 10 load levels, require occ>=5 intervals, first crossing avg > 15 min
const breakingPointRow = curve.find((r, i) => i >= 10 && r.occ >= 5 && r.ful > 15);
const breakingPoint = breakingPointRow ? breakingPointRow.conc : null;
const breakingPointGuests = breakingPointRow ? Math.round(breakingPointRow.guests) : null;
console.log('Breaking point (intervals):', breakingPoint, '| guests:', breakingPointGuests);

// ---- Stations ----
// A station target is the item-volume-weighted average of all targeted items
// assigned to that station for the selected week.
const itemVolume = {};
itemDetails.forEach(item => {
  if (!item.menuItem) return;
  itemVolume[item.menuItem] = (itemVolume[item.menuItem] || 0) + (item.qty || 1);
});

function stationNamesMatch(a, b) {
  const na = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nb = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na));
}

function deriveStationTarget(stationName) {
  let weighted = 0;
  let volume = 0;
  const fallbackTargets = [];
  Object.entries(ITEM_ASSIGNMENTS).forEach(([item, info]) => {
    if (!(info.stations || []).some(st => stationNamesMatch(st, stationName))) return;
    if (!(info.targetSec > 0)) return;
    fallbackTargets.push(info.targetSec);
    const qty = itemVolume[item] || 0;
    if (qty > 0) {
      weighted += info.targetSec * qty;
      volume += qty;
    }
  });
  if (volume > 0) return weighted / volume;
  return fallbackTargets.length
    ? fallbackTargets.reduce((sum, value) => sum + value, 0) / fallbackTargets.length
    : 0;
}

const derivedStationTargets = {};
const stationAgg = {};
foodTickets.forEach(t => {
  const st = t['Station'];
  if (!stationAgg[st]) stationAgg[st] = { count: 0, totalSec: 0 };
  stationAgg[st].count++;
  stationAgg[st].totalSec += t._fulSec;
});
const stations = Object.entries(stationAgg).map(([station, d]) => ({
  station,
  count: d.count,
  avg_sec: +(d.totalSec / d.count).toFixed(2),
  exp_sec: derivedStationTargets[station] = deriveStationTarget(station),
})).sort((a,b) => b.count - a.count);

// ---- Per-station breaking point using duration-weighted intervals ----
// For each station, collect its tickets (deduped within station) and build interval curve
const stationTicketsMap = {}; // station -> Set of unique ticket keys -> ticket
foodTickets.forEach(t => {
  const st = t['Station'];
  if (!st) return;
  if (!stationTicketsMap[st]) stationTicketsMap[st] = new Map();
  const key = `${t['Check #']}||${t['Fired Date']}||${t['Fulfillment Time']}`;
  if (!stationTicketsMap[st].has(key)) stationTicketsMap[st].set(key, t);
});

stations.forEach(stRow => {
  const st = stRow.station;
  const stTickets = stationTicketsMap[st] ? [...stationTicketsMap[st].values()] : [];
  if (stTickets.length === 0) { stRow.bp_tickets = null; stRow.bp_curve = []; return; }
  const threshold = stRow.exp_sec > 0 ? stRow.exp_sec / 60 : 15;
  const stCurve = buildIntervalCurve(stTickets);
  const bpRow = stCurve.find((r, i) => i >= 5 && r.occ >= 3 && r.ful > threshold);
  stRow.bp_tickets = bpRow ? bpRow.conc : null;
  stRow.bp_curve = stCurve;
});

// ---- stationDetails: per station, per day+hour ----
const stationDetails = {};
foodTickets.forEach(t => {
  const st = t['Station'];
  const day = DAYS[t._fired.getDay()];
  const hr = t._fired.getHours();
  const hrKey = `${hr}-${hr+1}`;
  if (!stationDetails[st]) stationDetails[st] = {};
  if (!stationDetails[st][day]) stationDetails[st][day] = {};
  if (!stationDetails[st][day][hrKey]) stationDetails[st][day][hrKey] = { count: 0, totalSec: 0 };
  stationDetails[st][day][hrKey].count++;
  stationDetails[st][day][hrKey].totalSec += t._fulSec;
});
// Convert to dashboard format: { stName: { byDayHour, hourly, breakingHours } }
const stationDetailsOut = {};
Object.keys(stationDetails).forEach(st => {
  const byDayHour = {};
  const hourlyAgg = {};
  const allRows = [];
  Object.keys(stationDetails[st]).forEach(day => {
    byDayHour[day] = {};
    Object.keys(stationDetails[st][day]).forEach(hr => {
      const d = stationDetails[st][day][hr];
      const avg_sec = +(d.totalSec / d.count).toFixed(1);
      byDayHour[day][hr] = { count: d.count, avg_sec, exp_sec: derivedStationTargets[st] || 0 };
      allRows.push({ day, hr, count: d.count, avg_sec, exp_sec: derivedStationTargets[st] || 0 });
      if (!hourlyAgg[hr]) hourlyAgg[hr] = { tw: 0, tc: 0 };
      hourlyAgg[hr].tw += d.totalSec;
      hourlyAgg[hr].tc += d.count;
    });
  });
  const hourly = {};
  Object.keys(hourlyAgg).forEach(hr => {
    const d = hourlyAgg[hr];
    hourly[hr] = { avg_sec: +(d.tw / d.tc).toFixed(1), exp_sec: derivedStationTargets[st] || 0 };
  });
  const breakingHours = allRows.filter(r => r.avg_sec > 900 && r.count > 0).slice(0, 20);
  stationDetailsOut[st] = { byDayHour, hourly, breakingHours };
});

// ---- Build ticket lookup by server+table+date (fuzzy match) ----
// Kitchen timing tickets don't share orderId/checkId with item-details rows.
// We match on server firstname + table + date prefix (e.g. "7/6/26").
const ticketByKey = {};
foodTickets.forEach(t => {
  const datePfx = (t['Fired Date'] || '').slice(0, 6); // "7/6/26"
  const key = (t['Server'] || '').split(' ')[0] + '|' + (t['Table'] || '') + '|' + datePfx;
  if (!ticketByKey[key]) ticketByKey[key] = [];
  ticketByKey[key].push(t);
});

// ---- Beverage filter for station items ----
const BEVERAGE_KEYWORDS = [
  // Waters & soft drinks
  'evian', 'pellegrino', 'perrier', 'water', 'coke', 'coca', 'diet',
  'sprite', 'soda', 'juice', 'lemonade', 'iced tea', 'ginger ale',
  // Beer
  'beer', 'kronenbourg', 'heineken', 'stella', 'bud', 'corona', 'draft',
  // Wine & champagne
  'wine', 'champagne', 'prosecco', 'sancerre', 'pinot', 'chardonnay',
  'bordeaux', 'burgundy', 'rosé', 'rose', 'chard', 'chablis', 'viognier',
  'malbec', 'cabernet', 'merlot', 'syrah', 'shiraz', 'riesling', 'sauvignon',
  'mathiasson', 'vista',
  // Spirits & cocktails
  'vodka', 'gin', 'rum', 'tequila', 'whiskey', 'whisky', 'bourbon', 'scotch',
  'mezcal', 'espadin', 'conejos', 'blanco', 'reposado', 'anejo',
  'tito', 'belvedere', 'hendricks', 'hendrick', 'johnnie', 'johnie', 'walker',
  'balvenie', 'macallan', 'glenlivet', 'glenfiddich', 'jameson',
  'beluga', 'grey goose', 'ketel', 'absolut', 'tanqueray', 'bombay',
  'bacardi', 'patron', 'don julio', 'casamigos', 'centinela',
  'martini', 'negroni', 'cocktail', 'spritz', 'aperol', 'campari',
  'cognac', 'armagnac', 'calvados', 'brandy', 'port', 'sherry', 'vermouth',
  // Coffee & tea
  'espresso', 'coffee', 'latte', 'cappuccino', 'tea', 'barista', 'americano',
  // Wine list prefixes used at these venues
  'gl ', 'benoit', 'chauveau', 'et fill',
  // Modifier/combo items that aren't real dishes
  'all in savory', 'all in dessert', 'all in ',
];
function isBeverageItem(name) {
  const n = (name || '').toLowerCase();
  return BEVERAGE_KEYWORDS.some(kw => n.includes(kw));
}

// ---- stationItemsArr: per-station item volume + avg fulfillment ----
const stationItemsMap = {}; // { station: { itemName: { qty, totalFulSec, count } } }

// Canonical station: once an item is assigned to a station, always use that station.
// This prevents items like "CL-Crab Croquettes" from appearing under multiple stations.
const itemFirstStation = {};

itemDetails.forEach(item => {
  if (!item.menuItem) return;
  if (isBeverageItem(item.menuItem)) return;
  const datePfx = (item.sentDate || '').slice(0, 6);
  const key = (item.server || '').split(' ')[0] + '|' + (item.table || '') + '|' + datePfx;
  const matches = ticketByKey[key] || [];
  if (matches.length === 0) return;

  const t = matches[0];
  const station = t['Station'];
  if (!station || !isFood(station)) return;

  // Lock to the first-seen station for this item (canonical mapping)
  if (!itemFirstStation[item.menuItem]) {
    itemFirstStation[item.menuItem] = station;
  }
  const canonicalStation = itemFirstStation[item.menuItem];

  if (!stationItemsMap[canonicalStation]) stationItemsMap[canonicalStation] = {};
  if (!stationItemsMap[canonicalStation][item.menuItem]) {
    stationItemsMap[canonicalStation][item.menuItem] = { qty: 0, totalFulSec: 0, count: 0 };
  }
  stationItemsMap[canonicalStation][item.menuItem].qty += (item.qty || 1);
  if (t._fulSec != null) {
    stationItemsMap[canonicalStation][item.menuItem].totalFulSec += t._fulSec;
    stationItemsMap[canonicalStation][item.menuItem].count++;
  }
});

// Convert to array format: { station: [{menuItem, qty, avgFulSec}] }
const stationItemsArr = {};
Object.keys(stationItemsMap).forEach(station => {
  stationItemsArr[station] = Object.entries(stationItemsMap[station])
    .map(([menuItem, d]) => ({
      menuItem,
      qty: d.qty,
      avgFulSec: d.count > 0 ? +(d.totalFulSec / d.count).toFixed(1) : null,
    }))
    .sort((a, b) => b.qty - a.qty);
});

// ---- assignmentData: flat list of food items with canonical station + fulfillment ----
// Join stationItemsArr (item→station) with item-fulfillment (item→avgSeconds from Toast report)
const itemToStation = {};
Object.entries(stationItemsArr).forEach(([station, items]) => {
  items.forEach(it => {
    if (!itemToStation[it.menuItem]) itemToStation[it.menuItem] = station;
  });
});

const itemFulPath = path.join(DATA_DIR, `item-fulfillment-${venueArg}.json`);
let itemFulfillmentItems = [];
if (fs.existsSync(itemFulPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(itemFulPath, 'utf8'));
    itemFulfillmentItems = raw.items || [];
  } catch(e) { console.warn('Could not load item-fulfillment:', e.message); }
}

const assignmentData = itemFulfillmentItems
  .filter(it => it.menuItem && !isBeverageItem(it.menuItem))
  .map(it => {
    const station = itemToStation[it.menuItem] || null;
    const targetSec = station ? (derivedStationTargets[station] || null) : null;
    return {
      menuItem: it.menuItem,
      station,
      targetSec,
      avgFulSec: it.avgSeconds || null,
      count: it.count || 0,
    };
  })
  .filter(it => it.station)
  .sort((a, b) => (a.station || '').localeCompare(b.station || '') || a.menuItem.localeCompare(b.menuItem));

console.log(`Assignment data for ${venueArg}: ${assignmentData.length} items across ${new Set(assignmentData.map(i=>i.station)).size} stations`);

// ---- menuItems: overall item volume + avg fulfillment across all stations ----
const menuItemsMap = {}; // { menuItem: { qty, totalFulSec, count } }
itemDetails.forEach(item => {
  if (!item.menuItem) return;
  const datePfx = (item.sentDate || '').slice(0, 6);
  const key = (item.server || '').split(' ')[0] + '|' + (item.table || '') + '|' + datePfx;
  const matches = ticketByKey[key] || [];
  if (!menuItemsMap[item.menuItem]) menuItemsMap[item.menuItem] = { qty: 0, totalFulSec: 0, count: 0 };
  menuItemsMap[item.menuItem].qty += (item.qty || 1);
  if (matches.length > 0 && matches[0]._fulSec != null) {
    menuItemsMap[item.menuItem].totalFulSec += matches[0]._fulSec;
    menuItemsMap[item.menuItem].count++;
  }
});

const summary = Object.entries(menuItemsMap)
  .map(([menuItem, d]) => ({
    menuItem,
    qty: d.qty,
    avgFulSec: d.count > 0 ? +(d.totalFulSec / d.count).toFixed(1) : null,
  }))
  .sort((a, b) => b.qty - a.qty);

// ---- Output ----
const output = {
  stations,
  summary,
  hmFul,
  hmGuests: hmGuestsFlat,
  hourProfile,
  curve,
  tbk,
  breakingPoint,
  breakingPointGuests,
  stationItemsArr,
  stationDetails: stationDetailsOut,
  assignmentData,
};

const outPath = path.join(__dirname, `${venueArg}-data.json`);
fs.writeFileSync(outPath, JSON.stringify(output), 'utf8');
console.log(`Written to ${outPath}`);
if (weekArg) {
  const weekOutPath = path.join(__dirname, `${venueArg}-data-${weekArg}.json`);
  fs.writeFileSync(weekOutPath, JSON.stringify(output), 'utf8');
  console.log(`Written to ${weekOutPath}`);
}
console.log('Stations:', stations.map(s => `${s.station}(${s.count})`).join(', '));
