'use strict';
/**
 * MILA cocktail station delimitation (Beverage mode).
 *
 * Toast still prints both families to KDS "Bar Central". We remap into:
 *   - Special Cocktails  ← menu group "MILA Bar Central Cocktails"
 *   - Classic Cocktails  ← menu group "MILA Classic Cocktails"
 *
 * Other venues can add group / name rules later without changing callers.
 */

const SPECIAL_COCKTAILS = 'Special Cocktails';
const CLASSIC_COCKTAILS = 'Classic Cocktails';

const STATION_NAMES = [SPECIAL_COCKTAILS, CLASSIC_COCKTAILS];

/** Toast menu groups → logical cocktail station (MILA first). */
const GROUP_RULES = [
  { venue: 'mila', re: /mila\s+bar\s*central\s+cocktails/i, station: SPECIAL_COCKTAILS },
  { venue: 'mila', re: /mila\s+classic\s+cocktails/i, station: CLASSIC_COCKTAILS },
  // Generic fallbacks if Toast renames slightly
  { venue: null, re: /\bclassic\s+cocktails?\b/i, station: CLASSIC_COCKTAILS },
  { venue: null, re: /\b(special|signature|bar\s*central)\s+cocktails?\b/i, station: SPECIAL_COCKTAILS },
];

/** Classic cocktail names (no M- prefix) when group is missing. */
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
 * @returns {string|null} station name or null if not a cocktail family item
 */
function classifyCocktailFamily(menuGroup, menuItem, venue) {
  const group = clean(menuGroup);
  const item = clean(menuItem);
  const v = String(venue || '').toLowerCase();

  for (const rule of GROUP_RULES) {
    if (rule.venue && rule.venue !== v && v !== '') continue;
    if (rule.re.test(group)) return rule.station;
  }

  if (!item) return null;

  // Signature / house cocktails (name fallback when group missing)
  const SPECIAL_NAME_RE = /^(m-)?(jasmine\s*hikari|velvet\s*komyo|golden\s*orchard|hidden\s*virtue|mila\s*paloma|enshoku|golden\s*frequency|murasaki\s*kori|soft\s*voltage|margarita\s*verde|cacao\s*smoke|verdant\s*air|jade\s*reverie|thyme\s*kohi|mila\s*g\s*&\s*t|amber\s*mirage|espresso\s*martini\s*reserve|aperol\s*spritz|hugo\s*spritz|pisco\s*sour|rdg\s*lychee\s*martini|beach\s*walk)$/i;
  if (SPECIAL_NAME_RE.test(item) || SPECIAL_NAME_RE.test(item.replace(/^m-/i, ''))) {
    return SPECIAL_COCKTAILS;
  }
  if (/^m-/i.test(item) && /hikari|komyo|orchard|virtue|paloma|enshoku|frequency|murasaki|voltage|margarita|cacao|verdant|reverie|thyme|kohi|g\s*&\s*t|amber\s*mirage|espresso\s*martini|hugo\s*spritz|aperol\s*spritz|pisco\s*sour|lychee\s*martini/i.test(item)) {
    return SPECIAL_COCKTAILS;
  }
  if (/^beach\s*walk$/i.test(item) || /^v\s*bar\s+mila\s+spritz$/i.test(item)) {
    return SPECIAL_COCKTAILS;
  }
  // Influencer / alc brunch variants of house cocktails → Special
  if (/\b(alc\s*)?br\s+.*margarita\s*verde\b/i.test(item) || /\bm-in\s+margarita\s*verde\b/i.test(item)) {
    return SPECIAL_COCKTAILS;
  }
  if (/\bmargarita\s*verde\b/i.test(item) || /\bjasmine\s*hikari\b/i.test(item)) {
    return SPECIAL_COCKTAILS;
  }

  const bare = stripName(item).replace(/^(br|alc\s*br|vbar|v\s*bar)\s+/i, '');
  if (CLASSIC_NAME_RE.test(bare) || CLASSIC_NAME_RE.test(stripName(item))) {
    return CLASSIC_COCKTAILS;
  }

  return null;
}

/** True if name is one of our logical cocktail stations (or raw Bar Central). */
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
 * Remap Toast prep stations for a scraped beverage item.
 * Keeps non-Bar-Central cocktail stations; replaces Bar Central with family.
 */
function remapBeverageStations(stations, menuGroup, menuItem, venue) {
  const fam = classifyCocktailFamily(menuGroup, menuItem, venue);
  const list = (stations || []).map(clean).filter(Boolean);
  if (!fam) return list;
  const withoutBc = list.filter(s => !/^bar\s*central/i.test(s));
  if (!withoutBc.includes(fam)) withoutBc.push(fam);
  return withoutBc.length ? withoutBc : [fam];
}

module.exports = {
  SPECIAL_COCKTAILS,
  CLASSIC_COCKTAILS,
  STATION_NAMES,
  classifyCocktailFamily,
  isCocktailFamilyStation,
  remapBeverageStations,
};
