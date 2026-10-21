'use strict';
/**
 * Cocktail station delimitation (Beverage mode) — all RDG venues.
 *
 * Toast KDS still prints cocktails to bar lanes (Bar Central, CL Bar POS, etc.).
 * We remap into logical families from Toast menu groups:
 *   - Special Cocktails  ← Signature / Bar Central cocktail groups
 *   - Classic Cocktails  ← Classic cocktail groups
 */

const SPECIAL_COCKTAILS = 'Special Cocktails';
const CLASSIC_COCKTAILS = 'Classic Cocktails';

const STATION_NAMES = [SPECIAL_COCKTAILS, CLASSIC_COCKTAILS];

/** Toast menu groups → Special / Classic (order: classic before signature). */
const GROUP_RULES = [
  // MILA
  { venue: 'mila', re: /mila\s+classic\s+cocktails/i, station: CLASSIC_COCKTAILS },
  { venue: 'mila', re: /mila\s+bar\s*central\s+cocktails/i, station: SPECIAL_COCKTAILS },
  // Claudie — CL- Signature / Classic
  { venue: 'claudie', re: /cl-?\s*classic\s+cocktails/i, station: CLASSIC_COCKTAILS },
  { venue: 'claudie', re: /cl-?\s*signature\s+cocktails/i, station: SPECIAL_COCKTAILS },
  // Casa Neos — CN Signature / Classic
  { venue: 'casa_neos', re: /cn\s+classic\s+cocktails/i, station: CLASSIC_COCKTAILS },
  { venue: 'casa_neos', re: /cn\s+signature\s+cocktails/i, station: SPECIAL_COCKTAILS },
  // AVA Coconut Grove — Signature / Classic
  { venue: 'ava_coconut_grove', re: /^classic\s+cocktails$/i, station: CLASSIC_COCKTAILS },
  { venue: 'ava_coconut_grove', re: /^(n\/?a\s+)?signature\s+cocktails$/i, station: SPECIAL_COCKTAILS },
  // AVA Winter Park — A-Classic / A-Bar Central
  { venue: 'ava_winter_park', re: /a-?\s*classic\s+cocktails/i, station: CLASSIC_COCKTAILS },
  { venue: 'ava_winter_park', re: /a-?\s*bar\s*central\s+cocktails/i, station: SPECIAL_COCKTAILS },
  // Generic fallbacks (any venue)
  { venue: null, re: /\bclassic\s+cocktails?\b/i, station: CLASSIC_COCKTAILS },
  { venue: null, re: /\b(special|signature)\s+cocktails?\b/i, station: SPECIAL_COCKTAILS },
  { venue: null, re: /\bbar\s*central\s+cocktails?\b/i, station: SPECIAL_COCKTAILS },
];

/** Map process-venue slug → cocktail-families venue key */
function normalizeVenueKey(venue) {
  const v = String(venue || '').toLowerCase();
  if (v === 'casaneos' || v === 'casa_neos') return 'casa_neos';
  if (v === 'ava_cg' || v === 'ava_coconut_grove') return 'ava_coconut_grove';
  if (v === 'ava_wp' || v === 'ava_winter_park') return 'ava_winter_park';
  return v;
}

/** Classic cocktail names when group is missing. */
const CLASSIC_NAME_RE = new RegExp(
  [
    '^amaretto\\s*sour$',
    '^americano(\\s*cocktail)?$',
    '^aperol\\s*spritz$',
    '^caipirinha$',
    '^caipiroska$',
    '^carajillo$',
    '^el\\s*diablo$',
    '^french\\s*75$',
    '^gimlet$',
    '^hot\\s*toddy$',
    '^hugo\\s*spritz$',
    '^long\\s*island(\\s*iced\\s*tea)?$',
    '^lychee\\s*martini$',
    '^negroni(\\s*sbagliato)?$',
    '^paper\\s*plane$',
    '^pisco\\s*sour$',
    '^sidecar$',
    '^singapor[e]?\\s*sling$',
    '^singapore\\s*sling$',
    '^southside$',
    '^tequila\\s*sunrise$',
    '^tom\\s*collins$',
    '^toronto$',
    '^tuxedo$',
    '^vesper$',
    '^vieux\\s*carre$',
    '^whiskey\\s*smash$',
    '^whiskey\\s*sour$',
    '^white\\s*lady$',
    '^white\\s*russian$',
    '^widow.?s\\s*kiss$',
    '^20th\\s*century$',
    '^sour$',
    '^moscow\\s*mule$',
  ].join('|'),
  'i'
);

function clean(s) {
  return String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripName(s) {
  return clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Resolve Special vs Classic from Toast menu group + item name.
 * @returns {string|null}
 */
function classifyCocktailFamily(menuGroup, menuItem, venue) {
  const group = clean(menuGroup);
  const item = clean(menuItem);
  const v = normalizeVenueKey(venue);

  for (const rule of GROUP_RULES) {
    if (rule.venue && rule.venue !== v && v !== '') continue;
    if (rule.re.test(group)) return rule.station;
  }

  if (!item) return null;

  const SPECIAL_NAME_RE = /^(m-|cl-|cn-|a-)?(jasmine\s*hikari|velvet\s*komyo|golden\s*orchard|hidden\s*virtue|mila\s*paloma|enshoku|golden\s*frequency|murasaki\s*kori|soft\s*voltage|margarita\s*verde|cacao\s*smoke|verdant\s*air|jade\s*reverie|thyme\s*kohi|mila\s*g\s*&\s*t|amber\s*mirage|espresso\s*martini\s*reserve|rdg\s*lychee\s*martini|beach\s*walk)$/i;
  if (SPECIAL_NAME_RE.test(item) || SPECIAL_NAME_RE.test(item.replace(/^(m-|cl-|cn-|a-)/i, ''))) {
    return SPECIAL_COCKTAILS;
  }
  if (/^beach\s*walk$/i.test(item)) return SPECIAL_COCKTAILS;

  const bare = stripName(item).replace(/^(br|alc\s*br|vbar|v\s*bar|cl-|cn-|a-|m-)\s*/i, '');
  if (CLASSIC_NAME_RE.test(bare) || CLASSIC_NAME_RE.test(stripName(item))) {
    return CLASSIC_COCKTAILS;
  }

  return null;
}

/** Logical beverage stations shown in the UI. */
function isCocktailFamilyStation(name) {
  const n = stripName(name);
  if (!n) return false;
  if (n === 'special cocktails' || n === 'classic cocktails') return true;
  if (/^bar\s*central(\s*2\.0\s*only)?$/.test(n)) return true;
  const compact = n.replace(/[^a-z0-9]/g, '');
  return compact === 'barcentral' || compact === 'barcentral20only'
    || compact === 'specialcocktails' || compact === 'classiccocktails';
}

/**
 * Raw Toast KDS stations that fire cocktail tickets (before Special/Classic remap).
 * Used as join candidates for item-details → kitchen timing.
 */
function isRawBarTicketStation(name, venue) {
  const n = stripName(name);
  if (!n) return false;
  const v = normalizeVenueKey(venue);

  // Never treat kitchen sushi / raw bar food as cocktail KDS
  if (/\bsushi\s*bar\b/.test(n) || /\braw\s*bar\b/.test(n)) return false;
  // Drop wine / champagne / barista / somm noise
  if (/wine|champagne|btg|barista|somm|corkage|no\s*print/.test(n)) return false;

  if (v === 'mila') {
    return /^bar\s*central/.test(n);
  }
  if (v === 'claudie') {
    return /^cl\s*bar\s*pos/.test(n) || /^sp\s*claudie\s*bar$/.test(n);
  }
  if (v === 'casa_neos') {
    // Cocktail lanes from Toast CN Signature/Classic prep (RPFL / Bar Fl)
    if (/beach\s*club|rooftop\s*beach/.test(n)) return false;
    return /\bbar\b/.test(n) && !/wine|somm|barista/.test(n);
  }
  if (v === 'ava_coconut_grove') {
    return /^bar\s*(indoor|terrace|mm)/.test(n);
  }
  if (v === 'ava_winter_park') {
    return /^bar\s*\d/.test(n) || /drink\s*expo|lounge\s*drinks/.test(n);
  }
  // Generic
  return /^bar\s*central/.test(n) || /\bbar\s*pos\b/.test(n);
}

/**
 * Remap Toast prep stations for a scraped beverage item.
 */
function remapBeverageStations(stations, menuGroup, menuItem, venue) {
  const fam = classifyCocktailFamily(menuGroup, menuItem, venue);
  const list = (stations || []).map(clean).filter(Boolean);
  if (!fam) return list;
  const withoutBar = list.filter(s => !isRawBarTicketStation(s, venue) && !/^bar\s*central/i.test(s));
  if (!withoutBar.includes(fam)) withoutBar.push(fam);
  return withoutBar.length ? withoutBar : [fam];
}

module.exports = {
  SPECIAL_COCKTAILS,
  CLASSIC_COCKTAILS,
  STATION_NAMES,
  normalizeVenueKey,
  classifyCocktailFamily,
  isCocktailFamilyStation,
  isRawBarTicketStation,
  remapBeverageStations,
};
