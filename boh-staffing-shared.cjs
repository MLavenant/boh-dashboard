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

/** Short alias → long slug used by venue week JSON filenames. */
const VENUE_SLUG_ALIASES = {
  casa_neos: 'casa_neos',
  mila: 'mila',
  ava_wp: 'ava_winter_park',
  ava_winter_park: 'ava_winter_park',
  ava_cg: 'ava_coconut_grove',
  ava_coconut_grove: 'ava_coconut_grove',
};

const STAFFING_VENUES = ['casa_neos', 'mila', 'ava_coconut_grove', 'ava_winter_park'];

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

module.exports = {
  FOOD_FAMILIES,
  FOOD_FAMILY_SET,
  CODE_TO_VENUE,
  VENUE_SLUG_ALIASES,
  STAFFING_VENUES,
  normalizeFoodFamily,
  isFoodFamily,
  resolveVenueSlug,
};
