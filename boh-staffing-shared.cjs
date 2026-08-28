/**
 * Shared constants / helpers for BOH station-family staffing.
 */
'use strict';

/** Canonical food-production station families (FTE Matrix after aliasing). */
const FOOD_FAMILIES = [
  'Saute',
  'Fry',
  'Garde Manger',
  'Raw',
  'Sushi',
  'Robata',
  'Pastry',
  'Expo',
  'Pizza',
  'Prep',
];

const FOOD_FAMILY_SET = new Set(FOOD_FAMILIES.map((f) => f.toLowerCase()));

/** Payroll company code → BOH long slug (dashboard process-venue slug). */
const CODE_TO_VENUE = {
  XPQ: 'casa_neos',
  XPM: 'mila',
  XYD: 'ava_winter_park',
  '0TJ': 'ava_coconut_grove',
};

/**
 * Viktor Ops FTE export (People tab) location label → BOH long slug.
 * MILA 2F + 3F both roll into mila.
 * Claudie included for FTE bank / CDP (station staffing join may still be venue-scoped).
 */
const LOCATION_TO_VENUE = {
  'CASA NEOS': 'casa_neos',
  'CASA NEOS LOUNGE': 'casa_neos_lounge',
  'AVA WP': 'ava_winter_park',
  'AVA CG': 'ava_coconut_grove',
  'MILA 3F': 'mila',
  'MILA 2F': 'mila',
  MILA: 'mila',
  CLAUDIE: 'claudie',
  Commissary: 'commissary',
  COMMISSARY: 'commissary',
};

/** Short alias → long slug used by venue week JSON filenames. */
const VENUE_SLUG_ALIASES = {
  casa_neos: 'casa_neos',
  casa_neos_lounge: 'casa_neos_lounge',
  mila: 'mila',
  ava_wp: 'ava_winter_park',
  ava_winter_park: 'ava_winter_park',
  ava_cg: 'ava_coconut_grove',
  ava_coconut_grove: 'ava_coconut_grove',
  claudie: 'claudie',
  commissary: 'commissary',
};

/** Venues used by station-staffing join (kitchen heatmaps). */
const STAFFING_VENUES = ['casa_neos', 'mila', 'ava_coconut_grove', 'ava_winter_park'];

/** All venues present in Viktor FTE bank (includes Claudie / lounge / commissary). */
const FTE_BANK_VENUES = [
  'casa_neos',
  'casa_neos_lounge',
  'mila',
  'ava_coconut_grove',
  'ava_winter_park',
  'claudie',
  'commissary',
];

/**
 * ISO week Monday/Sunday (UTC date strings YYYY-MM-DD).
 */
function isoWeekRange(weekLabel) {
  const m = String(weekLabel).match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`Bad week label: ${weekLabel}`);
  const year = +m[1];
  const week = +m[2];
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { weekKey: weekLabel, startDate: fmt(monday), endDate: fmt(sunday) };
}

function listIsoWeeks(fromKey, toKey) {
  const weeks = [];
  let cur = isoWeekRange(fromKey);
  const end = isoWeekRange(toKey);
  for (let i = 0; i < 80; i++) {
    weeks.push(cur);
    if (cur.weekKey === end.weekKey) break;
    const nextMon = new Date(cur.startDate + 'T12:00:00Z');
    nextMon.setUTCDate(nextMon.getUTCDate() + 7);
    const y = nextMon.getUTCFullYear();
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const day = jan4.getUTCDay() || 7;
    const week1Mon = new Date(jan4);
    week1Mon.setUTCDate(jan4.getUTCDate() - day + 1);
    const weekNum = Math.round((nextMon - week1Mon) / (7 * 86400000)) + 1;
    cur = isoWeekRange(`${nextMon.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`);
  }
  return weeks;
}

/**
 * Normalize FTE Matrix / alias → canonical food family, or null if non-food.
 */
function normalizeFoodFamily(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const low = s.toLowerCase().replace(/\s+/g, ' ');

  const aliases = {
    raw: 'Raw',
    crudo: 'Raw',
    saute: 'Saute',
    sautee: 'Saute',
    sauteed: 'Saute',
    pasta: 'Saute',
    fry: 'Fry',
    tempura: 'Fry',
    'garde manger': 'Garde Manger',
    salad: 'Garde Manger',
    mezze: 'Garde Manger',
    sushi: 'Sushi',
    maki: 'Sushi',
    robata: 'Robata',
    grill: 'Robata',
    grilll: 'Robata',
    plancha: 'Robata',
    pastry: 'Pastry',
    expo: 'Expo',
    pizza: 'Pizza',
    prep: 'Prep',
    butcher: 'Prep',
    oven: 'Robata',
    roast: 'Robata',
  };

  if (aliases[low]) return aliases[low];
  // Title-case exact match against allowlist
  for (const f of FOOD_FAMILIES) {
    if (f.toLowerCase() === low) return f;
  }
  return null;
}

function isFoodFamily(name) {
  return !!normalizeFoodFamily(name);
}

function resolveVenueSlug(raw) {
  const k = String(raw || '').trim();
  return VENUE_SLUG_ALIASES[k] || null;
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

/**
 * Parse "Last, First Middle" or "First Middle Last" → sorted key + tokens.
 */
function nameKey(raw) {
  let s = String(raw || '').trim();
  if (!s) return { key: '', tokens: [], display: '', compact: '' };
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((x) => x.trim());
    s = `${first || ''} ${last || ''}`.trim();
  }
  const tokens = stripDiacritics(s).split(' ').filter(Boolean);
  const key = [...tokens].sort().join(' ');
  return { key, tokens, display: s, compact: tokens.join('') };
}

function levenshtein(a, b) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const rows = s.length + 1;
  const cols = t.length + 1;
  const prev = new Array(cols);
  const curr = new Array(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    curr[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cols; j++) prev[j] = curr[j];
  }
  return prev[cols - 1];
}

function tokenClose(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  if (minLen < 3) return false;
  // Compound surname fragments: beau ⊂ beaubrun
  if (maxLen >= 7 && minLen >= 4 && (a.includes(b) || b.includes(a))) return true;
  const dist = levenshtein(a, b);
  const maxDist = maxLen <= 5 ? 1 : maxLen <= 9 ? 2 : 3;
  if (dist > maxDist) return false;
  // 1-char typos (Smith/Smyth): shared 2-letter prefix is enough
  if (dist === 1) return a.slice(0, 2) === b.slice(0, 2);
  const prefix = minLen <= 4 ? 2 : 3;
  return a.slice(0, prefix) === b.slice(0, prefix);
}

/** First names: allow 1-char typos (Jon/John) but not Maria/Maritza. */
function firstNameClose(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 3) return false;
  if (a.slice(0, 2) !== b.slice(0, 2)) return false;
  return levenshtein(a, b) <= 1;
}

/** Adjacent token joins so "beau"+"brun" ↔ "beaubrun". */
function expandTokenSet(tokens) {
  const out = new Set(tokens);
  out.add(tokens.join(''));
  for (let i = 0; i < tokens.length; i++) {
    let run = tokens[i];
    for (let j = i + 1; j < tokens.length; j++) {
      run += tokens[j];
      out.add(run);
    }
  }
  return out;
}

function setsOverlapFuzzy(setA, setB) {
  for (const a of setA) {
    for (const b of setB) {
      if (tokenClose(a, b)) return true;
    }
  }
  return false;
}

/**
 * Score 0–100 for Toast↔FTE name similarity. Threshold ≥72 is a confident match.
 * Handles: order swaps, diacritics, compound surnames, 1–3 char spelling mistakes.
 * Always requires a plausible first-name match to avoid middle-name collisions (Alec/Alej).
 */
function scoreNameMatch(a, b) {
  if (!a || !b || !a.tokens?.length || !b.tokens?.length) return 0;
  if (a.key && a.key === b.key) return 100;
  if (a.compact && a.compact === b.compact && a.tokens.length >= 2 && b.tokens.length >= 2) return 98;

  // One side is a single token (last-name only) — too ambiguous for a confident match
  if (a.tokens.length === 1 || b.tokens.length === 1) {
    if (a.tokens.length === 1 && b.tokens.length === 1) {
      return tokenClose(a.tokens[0], b.tokens[0]) ? 100 : 0;
    }
    return 0;
  }

  const expA = expandTokenSet(a.tokens);
  const expB = expandTokenSet(b.tokens);
  // Compact equality still needs first-name agreement when both have ≥2 tokens
  const firstA = a.tokens[0];
  const firstB = b.tokens[0];
  const lastA = a.tokens[a.tokens.length - 1];
  const lastB = b.tokens[b.tokens.length - 1];
  const firstOk = firstNameClose(firstA, firstB);

  if (!firstOk) {
    // Allow compound-surname-only rescue when compact forms match (Beaubrun already handled above)
    return 0;
  }

  if (a.compact && expB.has(a.compact)) return 96;
  if (b.compact && expA.has(b.compact)) return 96;

  // Surname: last tokens, or joins that end with the last token (beau+brun, zambrano+gonzalez order)
  const surnameForms = (tokens, exp) => {
    const last = tokens[tokens.length - 1];
    const set = new Set([last]);
    for (const t of exp) {
      if (t.length >= 5 && (t.endsWith(last) || last.endsWith(t) || t === last)) set.add(t);
    }
    // also adjacent pairs among trailing tokens
    if (tokens.length >= 2) {
      set.add(tokens[tokens.length - 2] + last);
    }
    if (tokens.length >= 3) {
      set.add(tokens[tokens.length - 3] + tokens[tokens.length - 2] + last);
    }
    return set;
  };
  const surA = surnameForms(a.tokens, expA);
  const surB = surnameForms(b.tokens, expB);
  const lastOk = setsOverlapFuzzy(surA, surB);

  let overlap = 0;
  const usedB = new Set();
  for (const ta of a.tokens) {
    for (let i = 0; i < b.tokens.length; i++) {
      if (usedB.has(i)) continue;
      if (tokenClose(ta, b.tokens[i]) || (i === 0 && firstNameClose(ta, b.tokens[i]))) {
        overlap++;
        usedB.add(i);
        break;
      }
    }
  }

  if (firstOk && lastOk) return overlap >= 2 ? 94 : 88;
  // First name matches but surname only via fuzzy secondary tokens (multi-part names)
  if (firstOk && overlap >= 2) return 80;
  return 0;
}

const NAME_MATCH_THRESHOLD = 72;

function namesMatch(a, b, threshold = NAME_MATCH_THRESHOLD) {
  return scoreNameMatch(a, b) >= threshold;
}

/**
 * Pick best roster row for a labor name. Returns { index, score, row } or null.
 */
function bestRosterMatch(laborNameKey, rosterByKey, threshold = NAME_MATCH_THRESHOLD) {
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < rosterByKey.length; i++) {
    const score = scoreNameMatch(laborNameKey, rosterByKey[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestScore < threshold) return null;
  return { index: bestIdx, score: bestScore, row: rosterByKey[bestIdx] };
}

module.exports = {
  FOOD_FAMILIES,
  FOOD_FAMILY_SET,
  CODE_TO_VENUE,
  LOCATION_TO_VENUE,
  VENUE_SLUG_ALIASES,
  STAFFING_VENUES,
  FTE_BANK_VENUES,
  isoWeekRange,
  listIsoWeeks,
  normalizeFoodFamily,
  isFoodFamily,
  resolveVenueSlug,
  stripDiacritics,
  nameKey,
  scoreNameMatch,
  namesMatch,
  bestRosterMatch,
  NAME_MATCH_THRESHOLD,
};
