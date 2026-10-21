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

function isFoodStationName(name) {
  const n = cleanStationName(name).toLowerCase();
  if (!n) return false;
  if (/^station\s*\d+$/i.test(n)) return false;
  // Kitchen sushi lanes — never treat as FOH bar
  if (/\bsushi\s*bar\b/.test(n)) return true;
  if (/\braw\s*bar\b/.test(n)) return true;
  // Logical cocktail families are beverage — not food
  if (/^(special|classic)\s+cocktails?$/i.test(n)) return false;
  // FOH / beverage bars
  if (/(^|[^a-z])bar([^a-z]|$)/i.test(n)) return false;
  const EXCL = [
    'champagne', 'wine', 'btg', 'pos', 'barista', 'somm', 'water', 'service', 'beach',
    'btl', 'drink', 'no print', 'noprint', 'host', 'runner', 'server', 'captain',
    'busser', 'bartender', 'sommelier', 'lounge',
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
