'use strict';
/**
 * Shared BOH food-station name filter.
 * Keeps cook / expo / prep stations; drops FOH bars & beverage.
 * Explicitly keeps "Sushi Bar" / "Sushi Bar, Cold" (contain the word "bar").
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

module.exports = { cleanStationName, isFoodStationName };
