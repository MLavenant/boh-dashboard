/**
 * Join FTE roster × Toast labor × kitchen station volume → staffing block.
 *
 * Usage:
 *   node build-station-staffing.cjs casa_neos 2026-W30
 *   node build-station-staffing.cjs --all 2026-W30
 *
 * Writes staffing into {venue}-data-{week}.json and data/{week}/staffing-{venue}.json
 * Also updates data/staffing-panel.jsonl for peer/history benchmarks.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  FOOD_FAMILIES,
  STAFFING_VENUES,
  resolveVenueSlug,
  normalizeFoodFamily,
  nameKey,
  bestRosterMatch,
} = require('./boh-staffing-shared.cjs');

const ROOT = process.env.BOH_ROOT || __dirname;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MIN_HOURS = 0.25;
const FOOD_SET = new Set(FOOD_FAMILIES);
// Expo/Prep/Fry qty↔labor joins are often imperfect — label caution, do not invent volumes
const WEAK_ATTR_FAMILIES = new Set(['Expo', 'Prep', 'Fry']);

let _jobFamilyMap = null;
let _peopleAssignments = null;

function loadJobFamilyMap() {
  if (_jobFamilyMap) return _jobFamilyMap;
  const p = path.join(ROOT, 'toast-job-family-map.json');
  _jobFamilyMap = fs.existsSync(p)
    ? JSON.parse(fs.readFileSync(p, 'utf8'))
    : { autoMap: {}, needsAssignment: ['Line Cook', 'CDP', 'Chef de Partie', 'Cook'] };
  return _jobFamilyMap;
}

function loadPeopleAssignments() {
  if (_peopleAssignments) return _peopleAssignments;
  const p = path.join(ROOT, 'people-station-assignments.json');
  const raw = fs.existsSync(p)
    ? JSON.parse(fs.readFileSync(p, 'utf8'))
    : { assignments: {} };
  const map = new Map();
  for (const [k, v] of Object.entries(raw.assignments || {})) {
    const fam = normalizeFoodFamily(v) || (FOOD_SET.has(v) ? v : null);
    if (!fam) continue;
    map.set(String(k).trim().toLowerCase(), fam);
    // also index by nameKey when key looks like a display name
    const nk = nameKey(k);
    if (nk.key) map.set(nk.key, fam);
  }
  _peopleAssignments = map;
  return map;
}

/** Auto family from specific Toast jobs (Prep Cook→Prep, Pastry Cook→Pastry, …). */
function autoFamilyFromJobs(jobs) {
  const cfg = loadJobFamilyMap();
  const autoMap = cfg.autoMap || {};
  let best = null;
  let bestRank = -1;
  for (const job of jobs || []) {
    const low = String(job || '').trim().toLowerCase();
    const mapped =
      normalizeFoodFamily(autoMap[job]) ||
      normalizeFoodFamily(autoMap[low]) ||
      normalizeFoodFamily(job);
    if (!mapped || !FOOD_SET.has(mapped)) continue;
    // Prefer explicit autoMap hits over fuzzy title normalize
    const rank = autoMap[job] || autoMap[low] ? 2 : 1;
    if (rank > bestRank) {
      best = mapped;
      bestRank = rank;
    }
  }
  return best;
}

function personAssignedFamily(payrollName, employeeName) {
  const map = loadPeopleAssignments();
  const nk = nameKey(payrollName || employeeName);
  if (nk.key && map.has(nk.key)) return map.get(nk.key);
  for (const cand of [payrollName, employeeName]) {
    if (!cand) continue;
    const hit = map.get(String(cand).trim().toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function jobNeedsPersonAssignment(jobs) {
  const needs = new Set(
    (loadJobFamilyMap().needsAssignment || []).map((j) => String(j).trim().toLowerCase())
  );
  return (jobs || []).some((j) => needs.has(String(j).trim().toLowerCase()));
}

const GUARDS = {
  minHours: 4,
  minHeads: 1,
  minVolume: 25,
  // Same-week RDG peers: 3 cells / 2 venues is enough for a directional signal;
  // history still prefers ≥6 prior same-DOW weeks when available.
  minPeerCells: 3,
  minPeerVenues: 2,
  minHistCells: 6,
};

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadNameAliases() {
  const p = path.join(ROOT, 'data', 'fte', 'name-aliases.json');
  if (!fs.existsSync(p)) return new Map();
  try {
    const j = loadJson(p);
    const map = new Map();
    const src = j.aliases || j;
    for (const [from, to] of Object.entries(src)) {
      if (from.startsWith('_')) continue;
      const f = String(from || '').trim().toLowerCase();
      const t = String(to || '').trim();
      if (f && t) map.set(f, t);
    }
    return map;
  } catch (_) {
    return new Map();
  }
}

function applyAlias(raw, aliases) {
  const s = String(raw || '').trim();
  if (!s) return s;
  const hit = aliases.get(s.toLowerCase());
  return hit || s;
}

/** Public dashboard label: "First L." — enough to see who, not full PII. */
function shortStaffLabel(fullName) {
  let s = String(fullName || '').trim();
  if (!s) return '—';
  // "Last, First" → treat as First + Last initial
  if (s.includes(',')) {
    const [lastPart, firstPart] = s.split(',').map((x) => x.trim());
    if (firstPart && lastPart) {
      const first = firstPart.split(/\s+/)[0];
      const last = lastPart.split(/\s+/).pop();
      const initial = (last || '').charAt(0).toUpperCase();
      return initial ? `${first} ${initial}.` : first;
    }
  }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const last = parts[parts.length - 1];
  const initial = last.charAt(0).toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}

/** Per-person rollup for public STAFF view (short labels, no full names). */
function buildPublicPlayers(byFamily) {
  const players = new Map();
  for (const [family, data] of Object.entries(byFamily)) {
    if (!FOOD_SET.has(family)) continue;
    for (const day of DAYS) {
      const cell = data.days[day];
      if (!cell || !cell.names?.length) continue;
      const vol = cell.volume || 0;
      const headN = cell.names.length;
      for (const n of cell.names) {
        const label = shortStaffLabel(n.toastName || n.name || '');
        const key = label.toLowerCase();
        if (!players.has(key)) {
          players.set(key, {
            label,
            position: n.position || '',
            families: new Set(),
            weekHours: 0,
            weekItems: 0,
            days: {},
          });
        }
        const p = players.get(key);
        p.families.add(family);
        const hrs = n.hours || 0;
        p.weekHours += hrs;
        const itemShare = headN > 0 ? vol / headN : 0;
        p.weekItems += itemShare;
        if (!p.days[day]) p.days[day] = { hours: 0, items: 0, families: [] };
        p.days[day].hours += hrs;
        p.days[day].items += itemShare;
        if (!p.days[day].families.includes(family)) p.days[day].families.push(family);
      }
    }
  }
  return [...players.values()]
    .map((p) => ({
      label: p.label,
      position: p.position,
      families: [...p.families].sort(),
      weekHours: +p.weekHours.toFixed(2),
      weekItems: Math.round(p.weekItems),
      weekItemsPerHour: p.weekHours > 0 ? +(p.weekItems / p.weekHours).toFixed(2) : null,
      days: Object.fromEntries(
        Object.entries(p.days).map(([d, v]) => [
          d,
          {
            hours: +v.hours.toFixed(2),
            items: Math.round(v.items),
            itemsPerHour: v.hours > 0 ? +(v.items / v.hours).toFixed(2) : null,
            families: v.families,
          },
        ])
      ),
    }))
    .sort((a, b) => b.weekItems - a.weekItems);
}

/** Jobs that should join to Viktor food-station families (excludes dish/receiver support). */
const FOOD_STATION_JOB_RE =
  /line cook|cdp|pastry|sushi|robata|saute|fry|garde|prep cook|expo|pizza|tempura|maki|grill|plancha|butcher|crudo|\braw\b|chef|training\s*-\s*boh|temp (line|cdp|pastry|prep)/i;

function isFoodStationJobName(jobName) {
  const j = String(jobName || '');
  if (normalizeFoodFamily(j)) return true;
  if (FOOD_STATION_JOB_RE.test(j)) return true;
  const cfg = loadJobFamilyMap();
  const low = j.trim().toLowerCase();
  if ((cfg.needsAssignment || []).some((x) => String(x).toLowerCase() === low)) return true;
  if (cfg.autoMap && (cfg.autoMap[j] || cfg.autoMap[low])) return true;
  return false;
}

function stationToFamily(stationName, familyMap) {
  const n = stripDiacritics(stationName);
  for (const ign of familyMap.ignore || []) {
    if (n.includes(stripDiacritics(ign))) return null;
  }
  let best = null;
  let bestLen = -1;
  for (const [family, cfg] of Object.entries(familyMap.families || {})) {
    const canon = normalizeFoodFamily(family) || family;
    if (!FOOD_SET.has(canon)) continue;
    for (const m of cfg.match || []) {
      const mm = stripDiacritics(m);
      if (n.includes(mm) && mm.length > bestLen) {
        best = canon;
        bestLen = mm.length;
      }
    }
  }
  return best;
}

function dayVolumeByFamily(venueData, familyMap) {
  /** family -> day -> volume, fulfillment, and union of active service hours */
  const out = {};
  const sdv = venueData.stationDayVolume || null;
  const makeRow = () => ({
    ticketCount: 0,
    itemQty: 0,
    fulSecSum: 0,
    fulWeight: 0,
    serviceHourKeys: new Set(),
  });

  if (sdv && Object.keys(sdv).length) {
    for (const [stName, byDay] of Object.entries(sdv)) {
      const family = stationToFamily(stName, familyMap);
      if (!family) continue;
      if (!out[family]) out[family] = {};
      for (const day of DAYS) {
        const cell = byDay[day];
        if (!cell) continue;
        if (!out[family][day]) out[family][day] = makeRow();
        const row = out[family][day];
        row.ticketCount += cell.ticketCount || 0;
        row.itemQty += cell.itemQty || 0;
        const fallbackHours = Object.entries(
          venueData.stationDetails?.[stName]?.byDayHour?.[day] || {}
        )
          .filter(([, hourCell]) => (hourCell.count || 0) > 0)
          .map(([hourKey]) => hourKey);
        for (const hourKey of cell.activeHourKeys || fallbackHours) {
          row.serviceHourKeys.add(hourKey);
        }
        if (cell.avgFulSec != null && (cell.ticketCount || 0) > 0) {
          row.fulSecSum += cell.avgFulSec * cell.ticketCount;
          row.fulWeight += cell.ticketCount;
        }
      }
    }
  } else {
    // Fallback: ticket fires from stationDetails
    for (const [stName, det] of Object.entries(venueData.stationDetails || {})) {
      const family = stationToFamily(stName, familyMap);
      if (!family) continue;
      if (!out[family]) out[family] = {};
      for (const day of DAYS) {
        const hrs = (det.byDayHour || {})[day] || {};
        let ticketCount = 0;
        let fulSecSum = 0;
        for (const cell of Object.values(hrs)) {
          ticketCount += cell.count || 0;
          fulSecSum += (cell.avg_sec || 0) * (cell.count || 0);
        }
        if (!out[family][day]) out[family][day] = makeRow();
        out[family][day].ticketCount += ticketCount;
        out[family][day].fulSecSum += fulSecSum;
        out[family][day].fulWeight += ticketCount;
        for (const [hourKey, cell] of Object.entries(hrs)) {
          if ((cell.count || 0) > 0) out[family][day].serviceHourKeys.add(hourKey);
        }
      }
    }
  }

  for (const fam of Object.values(out)) {
    for (const day of DAYS) {
      const c = fam[day];
      if (!c) continue;
      c.avgFulSec = c.fulWeight > 0 ? +(c.fulSecSum / c.fulWeight).toFixed(1) : null;
      // Prefer actual item quantity (Toast item-details × station assignment).
      // Fall back to KDS ticket fires when qty attribution is empty for that day.
      const qty = c.itemQty || 0;
      const tickets = c.ticketCount || 0;
      if (qty > 0) {
        c.volume = qty;
        c.volumeSource = 'itemQty';
      } else {
        c.volume = tickets;
        c.volumeSource = 'ticketCount';
      }
      c.serviceHours = c.serviceHourKeys.size;
      c.itemsPerServiceHour = c.serviceHours > 0
        ? +(c.volume / c.serviceHours).toFixed(2)
        : null;
    }
  }
  return out;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : +((s[mid - 1] + s[mid]) / 2).toFixed(4);
}

function pctRank(value, arr) {
  if (value == null || !arr.length) return null;
  const below = arr.filter((x) => x < value).length;
  return below / arr.length;
}

function loadPanel() {
  const p = path.join(ROOT, 'data', 'staffing-panel.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    })
    .filter(Boolean);
}

function writePanelRows(weekLabel, venue, byFamily) {
  const panelPath = path.join(ROOT, 'data', 'staffing-panel.jsonl');
  fs.mkdirSync(path.dirname(panelPath), { recursive: true });
  const existing = loadPanel().filter((r) => !(r.weekLabel === weekLabel && r.venue === venue));
  for (const fam of Object.values(byFamily)) {
    for (const day of DAYS) {
      const c = fam.days[day];
      if (!c || !c.heads) continue;
      existing.push({
        venue,
        weekLabel,
        family: fam.family,
        day,
        heads: c.heads,
        hours: c.hours,
        volume: c.volume,
        ticketCount: c.ticketCount,
        itemQty: c.itemQty,
        serviceHours: c.serviceHours,
        itemsPerServiceHour: c.itemsPerServiceHour,
        itemsPerHead: c.itemsPerHead,
        itemsPerStaffHour: c.itemsPerStaffHour,
        avgFulSec: c.avgFulSec,
        eligible: !!(c.qc && c.qc.eligible),
      });
    }
  }
  fs.writeFileSync(panelPath, existing.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function classifySignal(cell, family, venue, day, weekLabel, panel) {
  const base = {
    label: 'Building benchmark',
    code: 'insufficient_data',
    source: null,
    nPeer: 0,
    nHist: 0,
    note: null,
  };

  if (!cell.heads) {
    return { ...base, label: '—', code: 'closed_or_empty', note: 'No staff clocked' };
  }
  if (WEAK_ATTR_FAMILIES.has(family)) {
    return { ...base, label: 'Attribution caution', code: 'weak_attribution', note: `${family} volume/labor attribution is often imperfect` };
  }
  if (!cell.qc || !cell.qc.eligible) {
    return { ...base, note: cell.qc?.denyReason || 'Below sample guards' };
  }

  const hist = panel.filter((r) =>
    r.venue === venue &&
    r.family === family &&
    r.day === day &&
    r.eligible &&
    r.weekLabel !== weekLabel &&
    (r.itemsPerHead != null || (r.volume != null && r.heads > 0)) &&
    r.avgFulSec != null
  );
  const peers = panel.filter((r) =>
    r.venue !== venue &&
    STAFFING_VENUES.includes(r.venue) &&
    r.family === family &&
    r.day === day &&
    r.eligible &&
    (r.itemsPerHead != null || (r.volume != null && r.heads > 0)) &&
    r.avgFulSec != null
  );

  let ref = null;
  let source = null;
  if (hist.length >= GUARDS.minHistCells) {
    ref = hist;
    source = 'history';
  } else if (peers.length >= GUARDS.minPeerCells && new Set(peers.map((p) => p.venue)).size >= GUARDS.minPeerVenues) {
    ref = peers;
    source = 'peer';
  } else {
    // Same-week descriptive contrast still useful; no hard label
    return {
      ...base,
      nHist: hist.length,
      nPeer: peers.length,
      note: `Need ${GUARDS.minHistCells} history or ${GUARDS.minPeerCells} peer cells (≥${GUARDS.minPeerVenues} venues)`,
    };
  }

  const perHead = (r) => (r.itemsPerHead != null
    ? r.itemsPerHead
    : (r.heads > 0 ? +(r.volume / r.heads).toFixed(1) : null));
  const iphArr = ref.map(perHead).filter((x) => x != null);
  const fulArr = ref.map((r) => r.avgFulSec);
  const pI = pctRank(cell.itemsPerHead, iphArr);
  const pF = pctRank(cell.avgFulSec, fulArr);
  const medIph = median(iphArr);
  const expectedHeads = medIph > 0 ? +(cell.volume / medIph).toFixed(1) : null;
  const staffingRatio = expectedHeads > 0 ? +(cell.heads / expectedHeads).toFixed(2) : null;

  let code = 'in_band';
  let label = 'Balanced';
  if (pI >= 0.75 && pF >= 0.75) {
    code = 'understaffed_pressure';
    label = 'Likely understaffed';
  } else if (pI <= 0.25 && pF <= 0.50) {
    code = 'overstaffed_slack';
    label = 'Likely overstaffed';
  } else if (pI <= 0.50 && pF >= 0.75) {
    code = 'process_issue';
    label = 'Operational bottleneck';
  } else if (pI >= 0.75 && pF <= 0.50) {
    code = 'efficient_busy';
    label = 'Strong performance';
  }

  return {
    label,
    code,
    source,
    nPeer: peers.length,
    nHist: hist.length,
    pItemsPerHead: pI != null ? +pI.toFixed(2) : null,
    pFul: pF != null ? +pF.toFixed(2) : null,
    expectedHeads,
    staffingRatio,
    note: source === 'peer' ? 'vs RDG peer same-DOW' : 'vs own same-DOW history',
  };
}

function buildVenue(venueRaw, weekLabel) {
  const venue = resolveVenueSlug(venueRaw) || venueRaw;
  const rosterPath = path.join(ROOT, 'data', 'fte', `fte-roster-${weekLabel}.json`);
  const laborPath = path.join(ROOT, 'data', weekLabel, `labor-${venue}.json`);
  const mapPath = path.join(ROOT, `station-family-map-${venue}.json`);
  const venueDataPath = path.join(ROOT, `${venue}-data-${weekLabel}.json`);

  for (const p of [rosterPath, laborPath, mapPath, venueDataPath]) {
    if (!fs.existsSync(p)) throw new Error(`Missing ${p}`);
  }

  const rosterFile = loadJson(rosterPath);
  const laborFile = loadJson(laborPath);
  const familyMap = loadJson(mapPath);
  const venueData = loadJson(venueDataPath);

  const rosterAll = (rosterFile.venues && rosterFile.venues[venue]) || [];
  const roster = rosterAll.filter((r) => FOOD_SET.has(normalizeFoodFamily(r.matrix) || r.matrix));
  if (!roster.length) throw new Error(`No food FTE roster rows for ${venue} in ${rosterPath}`);

  const aliases = loadNameAliases();
  const rosterByKey = roster.map((r) => ({
    ...r,
    matrix: normalizeFoodFamily(r.matrix) || r.matrix,
    ...nameKey(applyAlias(r.name, aliases)),
  }));

  const laborByEmpDay = new Map();
  for (const e of laborFile.entries || []) {
    if ((e.hours || 0) < MIN_HOURS) continue;
    const id = e.employeeGuid || e.employeeName || e.payrollName;
    const k = `${id}|${e.date}`;
    if (!laborByEmpDay.has(k)) {
      laborByEmpDay.set(k, {
        date: e.date,
        day: e.day,
        employeeGuid: e.employeeGuid,
        employeeName: e.employeeName,
        payrollName: e.payrollName,
        hours: 0,
        jobs: new Set(),
      });
    }
    const row = laborByEmpDay.get(k);
    row.hours += e.hours || 0;
    if (e.jobName) row.jobs.add(e.jobName);
    if (!row.employeeName && e.employeeName) row.employeeName = e.employeeName;
    if (!row.payrollName && e.payrollName) row.payrollName = e.payrollName;
  }

  const matched = [];
  const unmatchedLabor = [];
  const usedRoster = new Set();

  for (const shift of laborByEmpDay.values()) {
    const jobs = [...shift.jobs];
    // Never join FOH-only punches onto the BOH food roster (avoids Server→cook false matches)
    const foodStationShift = jobs.some(isFoodStationJobName);
    if (!foodStationShift) {
      unmatchedLabor.push({
        date: shift.date,
        day: shift.day,
        employeeName: shift.employeeName,
        payrollName: shift.payrollName,
        hours: +shift.hours.toFixed(2),
        jobs,
      });
      continue;
    }

    const rawName = shift.payrollName || shift.employeeName;
    const nk = nameKey(applyAlias(rawName, aliases));
    const personFamily = personAssignedFamily(shift.payrollName, shift.employeeName);
    const autoFamily = autoFamilyFromJobs(jobs);
    const hit = bestRosterMatch(nk, rosterByKey);
    // Precedence: People-tab assignment → Toast auto-map (Prep/Pastry/…) → FTE Position
    const matrix =
      personFamily ||
      autoFamily ||
      (hit ? hit.row.matrix : null);

    if (!matrix || !FOOD_SET.has(matrix)) {
      unmatchedLabor.push({
        date: shift.date,
        day: shift.day,
        employeeName: shift.employeeName,
        payrollName: shift.payrollName,
        hours: +shift.hours.toFixed(2),
        jobs,
        needsAssignment: jobNeedsPersonAssignment(jobs),
      });
      continue;
    }

    if (hit) usedRoster.add(hit.index);
    const best = hit ? hit.row : null;
    matched.push({
      date: shift.date,
      day: shift.day,
      employeeName: shift.employeeName || best?.name || rawName,
      rosterName: best?.name || rawName,
      matrix,
      position: best?.position || jobs[0] || '',
      hours: +shift.hours.toFixed(2),
      jobs,
      nameMatchScore: hit ? hit.score : null,
      matrixSource: personFamily ? 'people_assignment' : autoFamily ? 'toast_job_auto' : 'fte_roster',
    });
  }

  const volumeByFamily = dayVolumeByFamily(venueData, familyMap);
  const panel = loadPanel();

  const byFamily = {};
  const ensureFamily = (f) => {
    const canon = normalizeFoodFamily(f) || f;
    if (!FOOD_SET.has(canon)) return null;
    if (!byFamily[canon]) {
      byFamily[canon] = {
        family: canon,
        rosterCount: roster.filter((r) => r.matrix === canon).length,
        days: {},
      };
      for (const day of DAYS) {
        const vol = volumeByFamily[canon]?.[day] || {};
        byFamily[canon].days[day] = {
          heads: 0,
          hours: 0,
          names: [],
          ticketCount: vol.ticketCount || 0,
          itemQty: vol.itemQty || 0,
          volume: vol.volume || 0,
          volumeSource: vol.volumeSource || 'ticketCount',
          itemCount: vol.volume || 0, // backward-compat alias
          itemsPerHead: null,
          serviceHours: vol.serviceHours || 0,
          itemsPerServiceHour: vol.itemsPerServiceHour ?? null,
          itemsPerStaffHour: null,
          avgFulSec: vol.avgFulSec != null ? vol.avgFulSec : null,
          qc: { eligible: false, denyReason: null },
          signal: null,
        };
      }
    }
    return byFamily[canon];
  };

  for (const r of roster) ensureFamily(r.matrix);
  for (const f of Object.keys(volumeByFamily)) ensureFamily(f);

  for (const m of matched) {
    const fam = ensureFamily(m.matrix);
    if (!fam) continue;
    const cell = fam.days[m.day];
    if (!cell) continue;
    if (cell.names.some((n) => n.name === m.rosterName || n.name === m.employeeName)) {
      const existing = cell.names.find((n) => n.name === m.rosterName || n.name === m.employeeName);
      existing.hours = +((existing.hours || 0) + m.hours).toFixed(2);
      cell.hours = +cell.names.reduce((s, n) => s + (n.hours || 0), 0).toFixed(2);
      continue;
    }
    cell.names.push({
      name: m.rosterName,
      toastName: m.employeeName,
      hours: m.hours,
      position: m.position,
      jobs: m.jobs,
    });
    cell.heads = cell.names.length;
    cell.hours = +cell.names.reduce((s, n) => s + (n.hours || 0), 0).toFixed(2);
  }

  for (const fam of Object.values(byFamily)) {
    for (const day of DAYS) {
      const cell = fam.days[day];
      const vol = volumeByFamily[fam.family]?.[day] || {};
      cell.ticketCount = vol.ticketCount || 0;
      cell.itemQty = vol.itemQty || 0;
      cell.volume = vol.volume || 0;
      cell.volumeSource = vol.volumeSource || 'ticketCount';
      cell.itemCount = cell.volume;
      cell.serviceHours = vol.serviceHours || 0;
      cell.itemsPerServiceHour = vol.itemsPerServiceHour ?? null;
      cell.avgFulSec = vol.avgFulSec != null ? vol.avgFulSec : null;
      cell.itemsPerHead = cell.heads > 0 ? +(cell.volume / cell.heads).toFixed(1) : null;
      cell.itemsPerStaffHour = cell.hours > 0 ? +(cell.volume / cell.hours).toFixed(2) : null;
      cell.names.sort((a, b) => a.name.localeCompare(b.name));

      let deny = null;
      if (!cell.heads) deny = 'No staff';
      else if (cell.hours < GUARDS.minHours) deny = `Hours < ${GUARDS.minHours}`;
      else if (cell.volume < GUARDS.minVolume) deny = `Volume < ${GUARDS.minVolume}`;
      cell.qc = { eligible: !deny, denyReason: deny };
    }
    fam.weekHeadsUnique = new Set(
      DAYS.flatMap((d) => (fam.days[d].names || []).map((n) => n.name))
    ).size;
    fam.weekHours = +DAYS.reduce((s, d) => s + (fam.days[d].hours || 0), 0).toFixed(2);
    fam.weekItemCount = DAYS.reduce((s, d) => s + (fam.days[d].volume || 0), 0);
    fam.weekTicketCount = DAYS.reduce((s, d) => s + (fam.days[d].ticketCount || 0), 0);
    fam.weekItemsPerHeadDay = (() => {
      const headDays = DAYS.reduce((s, d) => s + (fam.days[d].heads || 0), 0);
      return headDays > 0 ? +(fam.weekItemCount / headDays).toFixed(1) : null;
    })();
    fam.weekItemsPerStaffHour = fam.weekHours > 0
      ? +(fam.weekItemCount / fam.weekHours).toFixed(2)
      : null;
    fam.weekServiceHours = DAYS.reduce(
      (sum, day) => sum + (fam.days[day].serviceHours || 0),
      0
    );
    fam.weekItemsPerServiceHour = fam.weekServiceHours > 0
      ? +(fam.weekItemCount / fam.weekServiceHours).toFixed(2)
      : null;
    const fulW = DAYS.reduce((acc, d) => {
      const c = fam.days[d];
      if (c.avgFulSec != null && c.ticketCount > 0) {
        acc.sum += c.avgFulSec * c.ticketCount;
        acc.n += c.ticketCount;
      }
      return acc;
    }, { sum: 0, n: 0 });
    fam.weekAvgFulSec = fulW.n > 0 ? +(fulW.sum / fulW.n).toFixed(1) : null;
  }

  // Signals after cells built (panel may not yet include this week)
  for (const fam of Object.values(byFamily)) {
    for (const day of DAYS) {
      fam.days[day].signal = classifySignal(fam.days[day], fam.family, venue, day, weekLabel, panel);
    }
  }

  const toastStationFamily = {};
  for (const st of venueData.stations || []) {
    const f = stationToFamily(st.station, familyMap);
    if (f) toastStationFamily[st.station] = f;
  }

  const unmatchedRoster = rosterByKey
    .filter((_, i) => !usedRoster.has(i))
    .map((r) => ({ name: r.name, matrix: r.matrix, position: r.position }));

  const matchDenom = matched.length + unmatchedLabor.length;
  const matchRate = matchDenom > 0 ? matched.length / matchDenom : 0;

  const unmatchedBohLabor = unmatchedLabor.filter((u) => (u.jobs || []).some(isFoodStationJobName));
  const bohDenom = matched.length + unmatchedBohLabor.length;
  const bohMatchRate = bohDenom > 0 ? matched.length / bohDenom : 0;
  const rosterCoverage =
    roster.length > 0 ? (roster.length - unmatchedRoster.length) / roster.length : 0;

  const staffing = {
    venue,
    weekLabel,
    builtAt: new Date().toISOString(),
    source: {
      roster: path.basename(rosterPath),
      labor: path.basename(laborPath),
      familyMap: path.basename(mapPath),
    },
    matchStats: {
      laborShiftsMatched: matched.length,
      laborShiftsUnmatched: unmatchedLabor.length,
      rosterUnused: unmatchedRoster.length,
      rosterTotal: roster.length,
      matchRate: +matchRate.toFixed(3),
      bohLaborShiftsUnmatched: unmatchedBohLabor.length,
      bohMatchRate: +bohMatchRate.toFixed(3),
      rosterCoverage: +rosterCoverage.toFixed(3),
    },
    guestsSeated: venueData.guestsSeated || null,
    toastStationFamily,
    byFamily,
    unmatchedLabor,
    unmatchedRoster,
    unmatchedBohLabor,
  };

  writePanelRows(weekLabel, venue, byFamily);

  // Public embed: aggregates only, food families only
  const publicByFamily = {};
  for (const [family, data] of Object.entries(byFamily)) {
    if (!FOOD_SET.has(family)) continue;
    publicByFamily[family] = {
      family: data.family,
      rosterCount: data.rosterCount,
      weekHeadsUnique: data.weekHeadsUnique,
      weekHours: data.weekHours,
      weekItemCount: data.weekItemCount,
      weekTicketCount: data.weekTicketCount,
      weekItemsPerHeadDay: data.weekItemsPerHeadDay,
      weekItemsPerStaffHour: data.weekItemsPerStaffHour,
      weekServiceHours: data.weekServiceHours,
      weekItemsPerServiceHour: data.weekItemsPerServiceHour,
      weekAvgFulSec: data.weekAvgFulSec,
      days: {},
    };
    for (const day of DAYS) {
      const cell = data.days[day];
      // Public staff list: short labels only (First L.) — enough to see who was on
      const staff = (cell.names || []).map((n) => ({
        label: shortStaffLabel(n.toastName || n.name || ''),
        hours: n.hours != null ? n.hours : null,
        position: n.position || '',
      }));
      publicByFamily[family].days[day] = {
        heads: cell.heads,
        hours: cell.hours,
        staff,
        ticketCount: cell.ticketCount,
        itemQty: cell.itemQty,
        volume: cell.volume,
        volumeSource: cell.volumeSource,
        itemCount: cell.volume,
        itemsPerHead: cell.itemsPerHead,
        serviceHours: cell.serviceHours,
        itemsPerServiceHour: cell.itemsPerServiceHour,
        itemsPerStaffHour: cell.itemsPerStaffHour,
        avgFulSec: cell.avgFulSec,
        qc: { eligible: !!(cell.qc && cell.qc.eligible), denyReason: cell.qc?.denyReason || null },
        signal: cell.signal
          ? {
              label: cell.signal.label,
              code: cell.signal.code,
              source: cell.signal.source,
              nPeer: cell.signal.nPeer,
              nHist: cell.signal.nHist,
              note: cell.signal.note,
              staffingRatio: cell.signal.staffingRatio || null,
            }
          : null,
      };
    }
  }

  // Strip any legacy FOH families from prior embeds
  venueData.staffing = {
    venue,
    weekLabel,
    builtAt: staffing.builtAt,
    matchStats: staffing.matchStats,
    guestsSeated: staffing.guestsSeated,
    toastStationFamily,
    byFamily: publicByFamily,
    players: buildPublicPlayers(byFamily),
    foodFamiliesOnly: true,
  };
  // Keep BOH-only rates on public payload (no names) for pipeline / dashboard notes
  fs.writeFileSync(venueDataPath, JSON.stringify(venueData, null, 2));

  // Also refresh plain {venue}-data.json if present
  const plainPath = path.join(ROOT, `${venue}-data.json`);
  if (fs.existsSync(plainPath)) {
    try {
      const plain = loadJson(plainPath);
      plain.staffing = venueData.staffing;
      if (venueData.guestsSeated) plain.guestsSeated = venueData.guestsSeated;
      if (venueData.stationDayVolume) plain.stationDayVolume = venueData.stationDayVolume;
      fs.writeFileSync(plainPath, JSON.stringify(plain, null, 2));
    } catch (_) { /* optional */ }
  }

  const outDir = path.join(ROOT, 'data', weekLabel);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `staffing-${venue}.json`);
  fs.writeFileSync(outPath, JSON.stringify(staffing, null, 2));

  console.log(`Wrote ${outPath}`);
  console.log(`Updated ${venueDataPath}`);
  console.log('Match stats:', staffing.matchStats);
  console.log('Food families:', Object.keys(publicByFamily).join(', '));
  const saute = byFamily.Saute;
  if (saute) {
    console.log('Saute by day:');
    for (const day of DAYS) {
      const c = saute.days[day];
      console.log(
        `  ${day.slice(0, 3)}: heads=${c.heads} hours=${c.hours} vol=${c.volume} ipsh=${c.itemsPerStaffHour ?? '—'} ful=${c.avgFulSec != null ? (c.avgFulSec / 60).toFixed(1) + 'm' : '—'} · ${c.signal?.label || '—'}`
      );
    }
  }
  return staffing;
}

function main() {
  const arg1 = process.argv[2] || 'casa_neos';
  const weekLabel = process.argv[3] || '2026-W30';
  if (arg1 === '--all') {
    // First pass builds panel rows; second pass refreshes peer signals with full panel
    for (const v of STAFFING_VENUES) {
      try {
        buildVenue(v, weekLabel);
      } catch (e) {
        console.error(`[${v}] ${e.message}`);
      }
    }
    console.log('Second pass: refresh peer benchmark signals…');
    for (const v of STAFFING_VENUES) {
      try {
        buildVenue(v, weekLabel);
      } catch (e) {
        console.error(`[${v}] ${e.message}`);
      }
    }
    return;
  }
  buildVenue(arg1, weekLabel);
}

main();
