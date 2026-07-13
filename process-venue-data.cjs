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

const DATA_DIR = path.join(__dirname, 'data', '2026-W27');
const ktPath = path.join(DATA_DIR, `kitchen-timing-${venueArg}.json`);
const coversPath = path.join(DATA_DIR, `covers-${venueArg}.json`);

const ktRaw = JSON.parse(fs.readFileSync(ktPath, 'utf8'));
const coversRaw = JSON.parse(fs.readFileSync(coversPath, 'utf8'));

const tickets = ktRaw.tickets || ktRaw;
const covers = coversRaw.covers || coversRaw;

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

// ---- workloadOverall using sweep-line ----
// For each minute, count concurrent tickets
// Build events
const events = [];
foodTickets.forEach(t => {
  events.push({ time: t._fired.getTime(), type: 'start', ticket: t });
  events.push({ time: t._fulfilled.getTime(), type: 'end', ticket: t });
});
events.sort((a, b) => a.time - b.time);

// Sweep minute by minute from min to max
const minTime = Math.min(...foodTickets.map(t => t._fired.getTime()));
const maxTime = Math.max(...foodTickets.map(t => t._fulfilled.getTime()));

// For efficiency, use interval-based approach
// For each 1-minute slot, find concurrent tickets
// Group: for each concurrent count, accumulate slots and fulfillment times
const concMap = {}; // {count: {slots, sumFul, guestSum, guestCount}}

// Collect all unique start/end times to minimize work
// Build sorted event times
const allTimes = [...new Set(foodTickets.flatMap(t => [
  Math.floor(t._fired.getTime() / 60000) * 60000,
  Math.floor(t._fulfilled.getTime() / 60000) * 60000
]))].sort((a,b) => a-b);

// Sweep minute by minute using active set
// But to keep it reasonable, we'll sample every minute between min and max
const startMin = Math.floor(minTime / 60000);
const endMin = Math.ceil(maxTime / 60000);

// For large ranges, this could be slow. Let's use a smarter approach:
// Build events sorted by minute
const eventsByMin = {};
foodTickets.forEach(t => {
  const s = Math.floor(t._fired.getTime() / 60000);
  const e = Math.floor(t._fulfilled.getTime() / 60000);
  if (!eventsByMin[s]) eventsByMin[s] = { starts: [], ends: [] };
  if (!eventsByMin[e]) eventsByMin[e] = { starts: [], ends: [] };
  eventsByMin[s].starts.push(t);
  // end at minute e+1 (exclusive)
  const ep1 = e + 1;
  if (!eventsByMin[ep1]) eventsByMin[ep1] = { starts: [], ends: [] };
  eventsByMin[ep1].ends.push(t);
});

let active = new Set();
let currentMin = startMin;

for (let min = startMin; min <= endMin; min++) {
  const ev = eventsByMin[min];
  if (ev) {
    ev.starts.forEach(t => active.add(t));
    ev.ends.forEach(t => active.delete(t));
  }
  
  const count = active.size;
  if (count === 0) continue;
  
  // Compute avg fulfillment for active tickets
  const avgFul = [...active].reduce((s,t) => s + t._fulSec, 0) / count / 60;
  
  // Compute concurrent guests at this minute
  const ts = new Date(min * 60000);
  const guests = concurrentGuestsAt(ts);
  
  if (!concMap[count]) concMap[count] = { slots: 0, sumFul: 0, guestSum: 0, guestCount: 0 };
  concMap[count].slots++;
  concMap[count].sumFul += avgFul;
  if (guests > 0) { concMap[count].guestSum += guests; concMap[count].guestCount++; }
}

const curve = Object.keys(concMap).map(k => {
  const d = concMap[k];
  return {
    conc: +k,
    occ: d.slots,
    ful: +(d.sumFul / d.slots).toFixed(2),
    guests: d.guestCount > 0 ? +(d.guestSum / d.guestCount).toFixed(1) : 0,
  };
}).sort((a,b) => a.conc - b.conc);

// tbk: bucket by 10s
const tbkMap = {};
foodTickets.forEach(t => {
  const bucket = Math.floor(t._fulSec / 600) * 10;
  const label = `${bucket}-${bucket+10}`;
  if (!tbkMap[label]) tbkMap[label] = { sum: 0, count: 0, low: bucket };
  tbkMap[label].sum += t._fulSec / 60;
  tbkMap[label].count++;
});
const tbk = Object.entries(tbkMap).sort((a,b) => a[1].low - b[1].low).map(([label, d]) => ({
  bucket: label,
  ful: +(d.sum / d.count).toFixed(2),
}));

// Breaking point
const breakingPointRow = curve.find(r => r.ful > 15);
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

// ---- stationItemsArr: no menu items in this data ----
const stationItemsArr = {};

// ---- summary: no menu items ----
const summary = [];

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
console.log('Stations:', stations.map(s => `${s.station}(${s.count})`).join(', '));
