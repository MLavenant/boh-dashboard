/**
 * FourVenues Integrations API client (Auth v2: X-Api-Key).
 * Forecast rule: sum booking.price for status accepted | not-completed.
 *
 * Env (never commit keys):
 *   FV_API_KEY_MILA
 *   FV_API_KEY_CASA_NEOS
 *   FV_API_KEY_CASA_NEOS_BC
 *   FV_API_KEY_AVA (optional)
 */
'use strict';

const BASE = process.env.FV_API_BASE || 'https://api.fourvenues.com/integrations';

const VENUES = [
  {
    key: 'mila_lounge',
    name: 'MILA Lounge',
    envKey: 'FV_API_KEY_MILA',
    slug: 'mila1',
    id: 'Mmgkyvi0903mo01cm3vxg0phrtTEPpSM'
  },
  {
    key: 'casa_neos_lounge',
    name: 'Casa Neos Lounge',
    envKey: 'FV_API_KEY_CASA_NEOS',
    slug: 'casa-neos-lounge',
    id: 'mrph20a941lojvdykvq598p0b8j3576j'
  },
  {
    key: 'casa_neos_bc',
    name: 'Casa Neos Beach Club',
    envKey: 'FV_API_KEY_CASA_NEOS_BC',
    slug: 'casa-neos1',
    id: 'lah0f2isk8qmsg0zapu016rarffvp0xz'
  },
  {
    key: 'ava_lounge',
    name: 'AVA Lounge',
    envKey: 'FV_API_KEY_AVA',
    slug: 'ava',
    id: null,
    optional: true
  }
];

function tryLoadDotenv() {
  try {
    const path = require('path');
    require('dotenv').config({ path: path.join(__dirname, '.env') });
  } catch (_) {}
}

function getApiKey(venue) {
  tryLoadDotenv();
  const key = String(process.env[venue.envKey] || '').trim();
  return key || null;
}

function venuesWithKeys({ includeOptional = false } = {}) {
  return VENUES.filter(v => {
    if (v.optional && !includeOptional) return false;
    return !!getApiKey(v);
  });
}

function resolveVenue(venueKeyOrName) {
  if (!venueKeyOrName || venueKeyOrName === 'all') return null;
  const q = String(venueKeyOrName).toLowerCase();
  return VENUES.find(v =>
    v.key === q ||
    v.name.toLowerCase() === q ||
    (v.slug && v.slug === q)
  ) || null;
}

async function apiGet(apiKey, pathAndQuery) {
  const url = pathAndQuery.startsWith('http') ? pathAndQuery : `${BASE}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: {
      'X-Api-Key': apiKey,
      Accept: 'application/json'
    }
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || text.slice(0, 200);
    throw new Error(`FourVenues API ${res.status} ${pathAndQuery}: ${msg}`);
  }
  return data;
}

function isoDate(d) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const x = d instanceof Date ? d : new Date(d);
  return x.toISOString().slice(0, 10);
}

/** Default window: last 7 days through +21 days (upcoming forecast). */
function defaultDateRange(now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  const end = new Date(now);
  end.setDate(end.getDate() + 21);
  return { start: isoDate(start), end: isoDate(end) };
}

async function listEvents(venue, { start, end } = {}) {
  const range = { start: start || defaultDateRange().start, end: end || defaultDateRange().end };
  const apiKey = getApiKey(venue);
  if (!apiKey) throw new Error(`Missing ${venue.envKey} for ${venue.name}`);
  const data = await apiGet(apiKey, `/events/?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`);
  return { venue: venue.name, venueKey: venue.key, ...range, events: data.data || [] };
}

async function listBookings(venue, { start, end, date } = {}) {
  const apiKey = getApiKey(venue);
  if (!apiKey) throw new Error(`Missing ${venue.envKey} for ${venue.name}`);
  let path;
  if (date) {
    path = `/bookings/?date=${encodeURIComponent(isoDate(date))}`;
  } else {
    const range = { start: start || defaultDateRange().start, end: end || defaultDateRange().end };
    path = `/bookings/?start_date=${encodeURIComponent(range.start)}&end_date=${encodeURIComponent(range.end)}`;
  }
  const data = await apiGet(apiKey, path);
  return { venue: venue.name, venueKey: venue.key, bookings: data.data || [] };
}

function isCountableStatus(status) {
  const e = String(status || '').toLowerCase().trim().replace(/_/g, '-');
  return e === 'accepted' || e === 'not-completed' || e === 'not completed';
}

function bookingEventDate(b) {
  if (b.date) return isoDate(b.date);
  if (b.local_date && /^\d{4}-\d{2}-\d{2}/.test(b.local_date)) return b.local_date.slice(0, 10);
  return null;
}

/**
 * Export-equivalent forecast rows from bookings.
 * Metric: sum(price) where status in accepted | not-completed.
 */
function forecastFromBookings(venue, bookings) {
  const map = new Map();
  for (const b of bookings || []) {
    if (!isCountableStatus(b.status || b.state)) continue;
    const date = bookingEventDate(b);
    if (!date) continue;
    const dj = String(b.event_name || '').trim() || 'Event';
    const key = `${date}|${dj}`;
    if (!map.has(key)) {
      map.set(key, {
        venue: venue.name,
        venueKey: venue.key,
        date,
        dj,
        totalRevenue: 0,
        bookings: 0,
        eventId: b.event_id || null
      });
    }
    const g = map.get(key);
    g.totalRevenue += Number(b.price) || 0;
    g.bookings += 1;
    if (!g.eventId && b.event_id) g.eventId = b.event_id;
  }
  return [...map.values()]
    .map(g => ({
      ...g,
      totalRevenue: Math.round(g.totalRevenue * 100) / 100,
      source: 'fourvenues_integrations_api',
      hasData: true
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.dj.localeCompare(b.dj));
}

async function getForecastActuals({ venue = 'all', start, end } = {}) {
  const range = {
    start: start || defaultDateRange().start,
    end: end || defaultDateRange().end
  };
  const want = venue && venue !== 'all'
    ? [resolveVenue(venue)].filter(Boolean)
    : venuesWithKeys({ includeOptional: false });

  if (!want.length) {
    throw new Error('No FourVenues API keys configured (set FV_API_KEY_MILA / FV_API_KEY_CASA_NEOS / FV_API_KEY_CASA_NEOS_BC)');
  }

  const perVenue = [];
  const forecastRows = [];
  const errors = [];

  for (const v of want) {
    try {
      const { bookings } = await listBookings(v, range);
      const rows = forecastFromBookings(v, bookings);
      perVenue.push({
        venue: v.name,
        venueKey: v.key,
        bookingCount: bookings.length,
        eventCount: rows.length,
        revenueSum: rows.reduce((s, r) => s + r.totalRevenue, 0)
      });
      forecastRows.push(...rows);
    } catch (e) {
      errors.push({ venue: v.name, venueKey: v.key, error: e.message });
    }
  }

  return {
    pulledAt: new Date().toISOString(),
    period: { ...range, label: 'Integrations API bookings (accepted + not-completed price)' },
    perVenue,
    forecastRows,
    errors
  };
}

module.exports = {
  BASE,
  VENUES,
  getApiKey,
  venuesWithKeys,
  resolveVenue,
  listEvents,
  listBookings,
  forecastFromBookings,
  getForecastActuals,
  isCountableStatus,
  defaultDateRange,
  isoDate
};
