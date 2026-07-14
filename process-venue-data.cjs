'use strict';
const fs = require('fs');
const path = require('path');

const venueArg = process.argv[2];
if (!venueArg) { console.error('Usage: node process-venue-data.cjs <venue_slug>'); process.exit(1); }

// Load station targets config
let STATION_TARGETS = {};
try {
  const targetsPath = path.join(__dirname, 'station-targets.json');
  const allTargets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  // Map venue slug variants to config keys
  const keyMap = { claudie: 'claudie', casaneos: 'casaneos', ava_coconut_grove: 'ava_cg', ava_winter_park: 'ava_wp', mila: 'mila' };
  const configKey = keyMap[venueArg] || venueArg;
  STATION_TARGETS = allTargets[configKey] || {};
} catch(e) { /* targets file optional */ }

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

// Step 2: Build events — each ticket opens at _fired, closes at _fulfilled
// Sort: closes (type=0) before opens (type=1) at same timestamp (matches Python)
const wlEvents = [];
uniqueTickets.forEach(t => {
  wlEvents.push({ time: t._fired.getTime(), type: 1, ticket: t });
  wlEvents.push({ time: t._fulfilled.getTime(), type: 0, ticket: t });
});
wlEvents.sort((a, b) => a.time !== b.time ? a.time - b.time : a.type - b.type);

// Step 3: Walk events, track open set, record intervals
const intervals = []; // { duration_sec, concurrent_count, avg_fulfillment_sec, ot_guests }
const openSet = new Set();
let prevTime = null;

wlEvents.forEach(ev => {
  if (prevTime !== null && ev.time > prevTime && openSet.size > 0) {
    const duration_sec = (ev.time - prevTime) / 1000;
    const concurrent_count = openSet.size;
    const avg_fulfillment_sec = [...openSet].reduce((s, t) => s + t._fulSec, 0) / openSet.size;
    const ot_guests = concurrentGuestsAt(new Date(prevTime));
    intervals.push({ duration_sec, concurrent_count, avg_fulfillment_sec, ot_guests });
  }
  if (ev.type === 1) {
    openSet.add(ev.ticket);
  } else {
    openSet.delete(ev.ticket);
  }
  prevTime = ev.time;
});

// Step 4: Duration-weighted aggregation by concurrent_count
const concMap = {};
intervals.forEach(iv => {
  const k = iv.concurrent_count;
  if (!concMap[k]) concMap[k] = { intervals: 0, sumDur: 0, sumFulWeighted: 0, sumGuestWeighted: 0, guestDur: 0 };
  concMap[k].intervals++;
  concMap[k].sumDur += iv.duration_sec;
  concMap[k].sumFulWeighted += iv.avg_fulfillment_sec * iv.duration_sec;
  if (iv.ot_guests > 0) {
    concMap[k].sumGuestWeighted += iv.ot_guests * iv.duration_sec;
    concMap[k].guestDur += iv.duration_sec;
  }
});

const curve = Object.keys(concMap).map(k => {
  const d = concMap[k];
  return {
    conc: +k,
    occ: d.intervals,  // number of intervals at this concurrent load
    ful: +(d.sumFulWeighted / d.sumDur / 60).toFixed(2),  // duration-weighted avg in minutes
    guests: d.guestDur > 0 ? +(d.sumGuestWeighted / d.guestDur).toFixed(1) : 0,
  };
}).sort((a,b) => a.conc - b.conc);

// tbk: bucket curve by 10 concurrent tickets, weighted by occurrences
const tbkMap = {};
curve.forEach(r => {
  const bucket = Math.floor(r.conc / 10) * 10;
  const label = `${bucket}-${bucket+10}`;
  if (!tbkMap[label]) tbkMap[label] = { sumFul: 0, sumOcc: 0, low: bucket };
  tbkMap[label].sumFul += r.ful * r.occ; // weighted by interval count
  tbkMap[label].sumOcc += r.occ;
});
const tbk = Object.entries(tbkMap).sort((a,b) => a[1].low - b[1].low).map(([label, d]) => ({
  bucket: label,
  ful: d.sumOcc > 0 ? +(d.sumFul / d.sumOcc).toFixed(2) : 0,
}));

// Breaking point — skip first 10 load levels, require occ>=5, first crossing above 15 min
const breakingPointRow = curve.find((r, i) => i >= 10 && r.occ >= 5 && r.ful > 15);
const breakingPoint = breakingPointRow ? breakingPointRow.conc : null;
const breakingPointGuests = breakingPointRow ? Math.round(breakingPointRow.guests) : null;
console.log('Breaking point (tickets):', breakingPoint, '| guests:', breakingPointGuests);

// ---- Stations ----
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
  exp_sec: STATION_TARGETS[station] || 0,
})).sort((a,b) => b.count - a.count);

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
      byDayHour[day][hr] = { count: d.count, avg_sec, exp_sec: STATION_TARGETS[st] || 0 };
      allRows.push({ day, hr, count: d.count, avg_sec, exp_sec: STATION_TARGETS[st] || 0 });
      if (!hourlyAgg[hr]) hourlyAgg[hr] = { tw: 0, tc: 0 };
      hourlyAgg[hr].tw += d.totalSec;
      hourlyAgg[hr].tc += d.count;
    });
  });
  const hourly = {};
  Object.keys(hourlyAgg).forEach(hr => {
    const d = hourlyAgg[hr];
    hourly[hr] = { avg_sec: +(d.tw / d.tc).toFixed(1), exp_sec: STATION_TARGETS[st] || 0 };
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

// ---- stationItemsArr: per-station item volume + avg fulfillment ----
const stationItemsMap = {}; // { station: { itemName: { qty, totalFulSec, count } } }

itemDetails.forEach(item => {
  if (!item.menuItem) return;
  const datePfx = (item.sentDate || '').slice(0, 6);
  const key = (item.server || '').split(' ')[0] + '|' + (item.table || '') + '|' + datePfx;
  const matches = ticketByKey[key] || [];
  if (matches.length === 0) return;

  // Use first matching ticket's station
  const t = matches[0];
  const station = t['Station'];
  if (!station || !isFood(station)) return;
  if (!stationItemsMap[station]) stationItemsMap[station] = {};
  if (!stationItemsMap[station][item.menuItem]) {
    stationItemsMap[station][item.menuItem] = { qty: 0, totalFulSec: 0, count: 0 };
  }
  stationItemsMap[station][item.menuItem].qty += (item.qty || 1);
  if (t._fulSec != null) {
    stationItemsMap[station][item.menuItem].totalFulSec += t._fulSec;
    stationItemsMap[station][item.menuItem].count++;
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
  .sort((a, b) => b.qty - a.qty)
  .slice(0, 200);

// ---- Output ----
const output = {
  stations,
  summary,
  hmFul,
  hmGuests: hmGuestsFlat,
  curve,
  tbk,
  breakingPoint,
  breakingPointGuests,
  stationItemsArr,
  stationDetails: stationDetailsOut,
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
