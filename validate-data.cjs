'use strict';
const fs = require('fs');
const path = require('path');

// ---- Colors ----
const R = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';

function pass(msg)  { return `${GREEN}✅${R} ${msg}`; }
function warn(msg)  { return `${YELLOW}⚠️  ${R}${msg}`; }
function fail(msg)  { return `${RED}❌${R} ${msg}`; }
function info(msg)  { return `\x1b[34mℹ️  ${R}${msg}`; }

// ---- Same food-ticket filter as process-venue-data.cjs ----
const EXCLUDE_WORDS = ['bar','champagne','wine','btg','pos','barista','somm','water','service','beach','drink'];
function isFood(name) {
  if (!name) return false;
  const low = name.toLowerCase();
  return !EXCLUDE_WORDS.some(w => low.includes(w));
}

function parseFulTime(str) {
  if (!str) return null;
  const mMatch = str.match(/(\d+)\s*minute/);
  const sMatch = str.match(/(\d+)\s*second/);
  const m = mMatch ? parseInt(mMatch[1]) : 0;
  const s = sMatch ? parseInt(sMatch[1]) : 0;
  return m * 60 + s;
}

function parseDate(str) {
  if (!str) return null;
  try {
    const d = new Date(str.replace(/(\d+)\/(\d+)\/(\d+)/, (_, mo, dy, yr) =>
      `20${yr}-${mo.padStart(2,'0')}-${dy.padStart(2,'0')}`));
    return isNaN(d) ? null : d;
  } catch(e) { return null; }
}

// ---- Discover all venue×week combos ----
const ROOT = __dirname;
const DATA_ROOT = path.join(ROOT, 'data');

const weeks = fs.readdirSync(DATA_ROOT).filter(d => /^\d{4}-W\d{2}$/.test(d)).sort();

// Find all venues that have a processed file for a given week
function getVenuesForWeek(week) {
  const venues = [];
  const re = new RegExp(`^(.+)-data-${week}\\.json$`);
  for (const f of fs.readdirSync(ROOT)) {
    const m = f.match(re);
    if (m) venues.push(m[1]);
  }
  return venues;
}

let totalPass = 0, totalWarn = 0, totalFail = 0;

for (const week of weeks) {
  const venues = getVenuesForWeek(week);
  if (!venues.length) continue;

  for (const venue of venues) {
    const processed = JSON.parse(fs.readFileSync(path.join(ROOT, `${venue}-data-${week}.json`), 'utf8'));
    const weekDir = path.join(DATA_ROOT, week);

    console.log(`\n${BOLD}${CYAN}=== VALIDATION REPORT: ${venue} / ${week} ===${R}`);

    // ---- Check 1: Breaking Point sanity ----
    const curve = processed.curve || [];
    const bp = processed.breakingPoint;
    let check1;
    if (!curve.length) {
      check1 = fail('Check 1 (Breaking Point): no curve data');
      totalFail++;
    } else if (bp == null) {
      // null BP is legitimate: kitchen never crossed 15 min threshold after index 10
      const calcBPRow = curve.find((r, i) => i >= 10 && r.occ >= 5 && r.ful > 15);
      if (calcBPRow == null) {
        const maxFul = Math.max(...curve.slice(10).filter(r => r.occ >= 5).map(r => r.ful));
        check1 = info(`Check 1 (Breaking Point): no BP found (max ful after skip=${isFinite(maxFul) ? maxFul.toFixed(2) : 'n/a'} min, threshold=15)`);
      } else {
        check1 = fail(`Check 1 (Breaking Point): curve has BP at ${calcBPRow.conc} but stored BP=null — MISMATCH`);
        totalFail++;
      }
    } else {
      // Find BP using same logic as process-venue-data.cjs
      const calcBPRow = curve.find((r, i) => i >= 10 && r.occ >= 5 && r.ful > 15);
      const calcBP = calcBPRow ? calcBPRow.conc : null;

      if (calcBP !== bp) {
        check1 = fail(`Check 1 (Breaking Point): computed BP=${calcBP} but stored BP=${bp} — MISMATCH`);
        totalFail++;
      } else {
        // Check pre-BP level
        const bpIdx = curve.findIndex(r => r.conc === bp);
        const preBPRow = bpIdx > 0 ? curve[bpIdx - 1] : null;
        const preFul = preBPRow ? preBPRow.ful : null;
        if (preFul !== null && preFul > 15) {
          check1 = warn(`Check 1 (Breaking Point): BP=${bp} confirmed but pre-BP ful=${preFul} min (>15, non-clean crossing)`);
          totalWarn++;
        } else {
          const preStr = preFul !== null ? `, pre-BP ful=${preFul} min` : '';
          check1 = pass(`Check 1 (Breaking Point): BP=${bp}, confirmed${preStr}`);
          totalPass++;
        }
      }
    }
    console.log(check1);

    // ---- Check 2: Total ticket count ----
    const ktPath = path.join(weekDir, `kitchen-timing-${venue}.json`);
    let check2;
    if (!fs.existsSync(ktPath)) {
      check2 = warn(`Check 2 (Ticket count): no kitchen-timing file found`);
      totalWarn++;
    } else {
      const ktRaw = JSON.parse(fs.readFileSync(ktPath, 'utf8'));
      const tickets = ktRaw.tickets || ktRaw;

      // Apply same filter as process-venue-data.cjs
      const rawCount = tickets.filter(t => {
        if (!isFood(t['Station'])) return false;
        const fired = parseDate(t['Fired Date']);
        const fulSec = parseFulTime(t['Fulfillment Time']);
        return fired && fulSec != null;
      }).length;

      // Derive processed count from sum of station counts
      const processedCount = (processed.stations || []).reduce((s, st) => s + (st.count || 0), 0);

      if (processedCount === 0) {
        check2 = warn(`Check 2 (Ticket count): no stations data, skipping`);
        totalWarn++;
      } else {
        const diff = Math.abs(rawCount - processedCount) / processedCount;
        const pct = (diff * 100).toFixed(2);
        if (diff <= 0.01) {
          check2 = pass(`Check 2 (Ticket count): Raw=${rawCount.toLocaleString()}, Processed=${processedCount.toLocaleString()} (diff=${pct}%)`);
          totalPass++;
        } else if (diff <= 0.05) {
          check2 = warn(`Check 2 (Ticket count): Raw=${rawCount.toLocaleString()}, Processed=${processedCount.toLocaleString()} (diff=${pct}%) — WARN`);
          totalWarn++;
        } else {
          check2 = fail(`Check 2 (Ticket count): Raw=${rawCount.toLocaleString()}, Processed=${processedCount.toLocaleString()} (diff=${pct}%) — FAIL`);
          totalFail++;
        }
      }
    }
    console.log(check2);

    // ---- Check 3: Station fulfillment sanity ----
    const stations = processed.stations || [];
    const lowSample = stations.filter(s => s.count < 5).map(s => s.station);
    const badAvg = stations.filter(s => s.avg_sec <= 0 || s.count <= 0);
    const tooHigh = stations.filter(s => s.avg_sec > 3600);
    let check3;
    if (badAvg.length > 0) {
      check3 = fail(`Check 3 (Stations): ${badAvg.length} station(s) with avg_sec<=0 or count<=0: [${badAvg.map(s=>s.station).join(', ')}]`);
      totalFail++;
    } else if (tooHigh.length > 0) {
      check3 = fail(`Check 3 (Stations): ${tooHigh.length} station(s) with avg_sec>3600: [${tooHigh.map(s=>s.station).join(', ')}]`);
      totalFail++;
    } else if (lowSample.length > 0) {
      check3 = warn(`Check 3 (Stations): ${lowSample.length} station(s) with LOW SAMPLE (<5 tickets): [${lowSample.join(', ')}]`);
      totalWarn++;
    } else {
      check3 = pass(`Check 3 (Stations): all ${stations.length} stations look healthy`);
      totalPass++;
    }
    console.log(check3);

    // ---- Check 4: Item-to-station mapping coverage ----
    const ifPath = path.join(weekDir, `item-fulfillment-${venue}.json`);
    const idPath = path.join(weekDir, `item-details-${venue}.json`);
    let check4;
    if (!fs.existsSync(ifPath) || !fs.existsSync(idPath)) {
      check4 = info(`Check 4 (Item mapping): skipped — item-fulfillment or item-details file missing`);
    } else {
      const ifRaw = JSON.parse(fs.readFileSync(ifPath, 'utf8'));
      const idRaw = JSON.parse(fs.readFileSync(idPath, 'utf8'));

      // item-fulfillment: list of custom report items (menuItem names)
      const ifItems = ifRaw.items || ifRaw;
      const ifNames = new Set(
        (Array.isArray(ifItems) ? ifItems : [])
          .map(r => r.menuItem || r.name || r.item || r['Menu Item'] || r['Item'])
          .filter(Boolean)
      );

      // item-details: has station mapping via kitchen-timing join
      // Check what stationItemsArr covers from the processed JSON
      const stationItemsArr = processed.stationItemsArr || {};
      const mappedItems = new Set();
      Object.values(stationItemsArr).forEach(items => {
        (items || []).forEach(i => { if (i.menuItem) mappedItems.add(i.menuItem); });
      });

      if (ifNames.size === 0) {
        check4 = info(`Check 4 (Item mapping): no items found in item-fulfillment file`);
      } else {
        const matched = [...ifNames].filter(n => mappedItems.has(n)).length;
        const pct = Math.round(matched / ifNames.size * 100);
        if (pct >= 80) {
          check4 = pass(`Check 4 (Item mapping): ${pct}% of items matched to a station (${matched}/${ifNames.size})`);
          totalPass++;
        } else if (pct >= 50) {
          check4 = warn(`Check 4 (Item mapping): ${pct}% of items matched to a station (${matched}/${ifNames.size}) — WARN`);
          totalWarn++;
        } else {
          check4 = fail(`Check 4 (Item mapping): ${pct}% of items matched to a station (${matched}/${ifNames.size}) — FAIL`);
          totalFail++;
        }
      }
    }
    console.log(check4);

    // ---- Check 5: OpenTable covers ----
    const coversPath = path.join(weekDir, `covers-${venue}.json`);
    let check5;
    if (!fs.existsSync(coversPath)) {
      check5 = info(`Check 5 (Covers): no covers file found`);
    } else {
      const coversRaw = JSON.parse(fs.readFileSync(coversPath, 'utf8'));
      const covers = coversRaw.covers || coversRaw;
      const totalCovers = Array.isArray(covers)
        ? covers.reduce((s, c) => s + (c.partySize || 1), 0)
        : 0;
      const bpGuests = processed.breakingPointGuests;
      const note = bpGuests ? ` (BP guests=${bpGuests})` : '';
      check5 = info(`Check 5 (Covers): ${totalCovers.toLocaleString()} OT covers this week${note}`);
    }
    console.log(check5);
  }
}

// ---- Summary ----
console.log(`\n${BOLD}=== SUMMARY ===${R}`);
console.log(`${GREEN}PASS: ${totalPass}${R}  ${YELLOW}WARN: ${totalWarn}${R}  ${RED}FAIL: ${totalFail}${R}`);
if (totalFail > 0) process.exit(1);
