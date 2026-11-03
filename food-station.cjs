'use strict';
/**
 * Shared BOH station name filters.
 *
 * Food: cook / expo / prep — drops FOH bars & beverage.
 *   Explicitly keeps "Sushi Bar" / "Sushi Bar, Cold" (contain the word "bar").
 *
 * Beverage (MILA cocktails first): cocktail lanes only.
 *   Logical: Special Cocktails / Classic Cocktails (remapped from Bar Central).
 *   Raw Toast KDS: Bar Central, Bar Central 2.0 only (still accepted).
 */
const { isCocktailFamilyStation } = require('./cocktail-families.cjs');

function cleanStationName(s) {
  return String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Cook / expo lanes that live under a Lounge / MM Club roof (not FOH bar printers). */
const LOUNGE_FOOD_RE =
  /\b(pastry|gelato|passion|saute|sauteed|sauté|fry|garde|maki|meat|fish|raw|expo|paella|cold|hot|pizza|sushi|robata|prep|pantry|salad|crudo|tempura|grill|plancha|oven|food)\b/i;

function isFoodStationName(name) {
  const n = cleanStationName(name).toLowerCase();
  if (!n) return false;
  if (/^station\s*\d+$/i.test(n)) return false;
  // Kitchen sushi lanes — never treat as FOH bar
  if (/\bsushi\s*bar\b/.test(n)) return true;
  if (/\braw\s*bar\b/.test(n)) return true;
  // MM Club / 2F dessert print stations
  if (/^2f[-\s]?(passion|gelato)\b/i.test(n) || /\b(2f[-\s]?passion|2f[-\s]?gelato)\b/i.test(n)) return true;
  // Logical cocktail families are beverage — not food
  if (/^(special|classic)\s+cocktails?$/i.test(n)) return false;
  // FOH / beverage bars
  if (/(^|[^a-z])bar([^a-z]|$)/i.test(n)) return false;
  // Lounge roof: keep cook lines (Pastry Lounge, Sauteed 1 Lounge, …); drop lounge bar/POS/only
  if (/\blounge\b/.test(n)) {
    if (/\b(pos|only|service\s*printer|wine|somm|barista|drink|runner|server|host)\b/.test(n)) return false;
    return LOUNGE_FOOD_RE.test(n);
  }
  const EXCL = [
    'champagne', 'wine', 'btg', 'pos', 'barista', 'somm', 'water', 'service', 'beach',
    'btl', 'drink', 'no print', 'noprint', 'host', 'runner', 'server', 'captain',
    'busser', 'bartender', 'sommelier',
  ];
  return !EXCL.some((w) => n.includes(w));
}

/** MILA cocktail stations (Beverage mode) — Special / Classic + raw Bar Central. */
function isCocktailStationName(name) {
  return isCocktailFamilyStation(name);
}

module.exports = {
  cleanStationName,
  isFoodStationName,
  isCocktailStationName,
};
