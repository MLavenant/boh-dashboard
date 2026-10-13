'use strict';
/**
 * Shared BOH station name filters.
 *
 * Food: cook / expo / prep — drops FOH bars & beverage.
 *   Explicitly keeps "Sushi Bar" / "Sushi Bar, Cold" (contain the word "bar").
 *
 * Beverage (MILA cocktails first): cocktail KDS lanes only.
 *   Allowlist: Bar Central, Bar Central 2.0 only.
 *   Drops wine/lounge/POS/barista noise.
 */
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
  // FOH / beverage bars
  if (/(^|[^a-z])bar([^a-z]|$)/i.test(n)) return false;
  const EXCL = [
    'champagne', 'wine', 'btg', 'pos', 'barista', 'somm', 'water', 'service', 'beach',
    'btl', 'drink', 'no print', 'noprint', 'host', 'runner', 'server', 'captain',
    'busser', 'bartender', 'sommelier', 'lounge',
  ];
  return !EXCL.some((w) => n.includes(w));
}

/** MILA cocktail KDS stations (Beverage mode). */
function isCocktailStationName(name) {
  const n = cleanStationName(name).toLowerCase();
  if (!n) return false;
  // Primary cocktail lane
  if (/^bar\s*central(\s*2\.0\s*only)?$/i.test(n)) return true;
  if (n === 'bar central' || n === 'bar central 2.0 only') return true;
  // Normalized: "barcentral", "barcentral20only"
  const compact = n.replace(/[^a-z0-9]/g, '');
  if (compact === 'barcentral' || compact === 'barcentral20only') return true;
  return false;
}

module.exports = {
  cleanStationName,
  isFoodStationName,
  isCocktailStationName,
};
