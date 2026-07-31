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
} = require('./boh-staffing-shared.cjs');

const ROOT = process.env.BOH_ROOT || __dirname;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MIN_HOURS = 0.25;
const FOOD_SET = new Set(FOOD_FAMILIES);
const WEAK_ATTR_FAMILIES = new Set(['Expo', 'Prep']);

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

function nameKey(raw) {
  let s = String(raw || '').trim();
  if (!s) return { key: '', tokens: [] };
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((x) => x.trim());
    s = `${first || ''} ${last || ''}`.trim();
  }
  const tokens = stripDiacritics(s).split(' ').filter(Boolean);
  const key = [...tokens].sort().join(' ');
  return { key, tokens, display: s };
}

function namesMatch(a, b) {
  if (!a.key || !b.key) return false;
  if (a.key === b.key) return true;
  const setA = new Set(a.tokens);
  const setB = new Set(b.tokens);
  const overlap = a.tokens.filter((t) => setB.has(t));
  if (overlap.length >= Math.min(2, Math.max(a.tokens.length, b.tokens.length))) return true;
  if (a.tokens.length >= 2 && b.tokens.length >= 2) {
    const lastA = a.tokens[a.tokens.length - 1];
    const lastB = b.tokens[b.tokens.length - 1];
    const firstA = a.tokens[0];
    const firstB = b.tokens[0];
    if ((lastA === lastB || setA.has(lastB) || setB.has(lastA)) &&
        (firstA === firstB || setA.has(firstB) || setB.has(firstA))) {
      return true;
    }
  }
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

  const rosterByKey = roster.map((r) => ({
    ...r,
    matrix: normalizeFoodFamily(r.matrix) || r.matrix,
    ...nameKey(r.name),
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
    const nk = nameKey(shift.payrollName || shift.employeeName);
    let best = null;
    for (let i = 0; i < rosterByKey.length; i++) {
      if (namesMatch(nk, rosterByKey[i])) {
        best = rosterByKey[i];
        usedRoster.add(i);
        break;
      }
    }
    if (!best) {
      unmatchedLabor.push({
        date: shift.date,
        day: shift.day,
        employeeName: shift.employeeName,
        payrollName: shift.payrollName,
        hours: +shift.hours.toFixed(2),
        jobs: [...shift.jobs],
      });
      continue;
    }
    matched.push({
      date: shift.date,
      day: shift.day,
      employeeName: shift.employeeName || best.name,
      rosterName: best.name,
      matrix: best.matrix,
      position: best.position,
      hours: +shift.hours.toFixed(2),
      jobs: [...shift.jobs],
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
    },
    guestsSeated: venueData.guestsSeated || null,
    toastStationFamily,
    byFamily,
    unmatchedLabor: unmatchedLabor.slice(0, 80),
    unmatchedRoster: unmatchedRoster.slice(0, 80),
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
      publicByFamily[family].days[day] = {
        heads: cell.heads,
        hours: cell.hours,
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
    foodFamiliesOnly: true,
  };
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
