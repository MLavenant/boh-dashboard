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

async function apiGet(apiKey, pathAndQuery, { retries = 3 } = {}) {
  const url = pathAndQuery.startsWith('http') ? pathAndQuery : `${BASE}${pathAndQuery}`;
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
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
        const err = new Error(`FourVenues API ${res.status} ${pathAndQuery}: ${msg}`);
        /* Retry transient rate limits / gateway errors. */
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await new Promise(r => setTimeout(r, 400 * attempt));
          lastErr = err;
          continue;
        }
        throw err;
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) throw e;
      await new Promise(r => setTimeout(r, 400 * attempt));
    }
  }
  throw lastErr || new Error('FourVenues API failed');
}

function isoDate(d) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const x = d instanceof Date ? d : new Date(d);
  return x.toISOString().slice(0, 10);
}

/** Default window: last 7 days through +30 days (morning-stable; was +40 then +21). */
function defaultDateRange(now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  const end = new Date(now);
  end.setDate(end.getDate() + 30);
  return { start: isoDate(start), end: isoDate(end) };
}

async function listEvents(venue, { start, end } = {}) {
  const range = { start: start || defaultDateRange().start, end: end || defaultDateRange().end };
  const apiKey = getApiKey(venue);
  if (!apiKey) throw new Error(`Missing ${venue.envKey} for ${venue.name}`);
  const data = await apiGet(apiKey, `/events/?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`);
  return { venue: venue.name, venueKey: venue.key, ...range, events: data.data || [] };
}

/** Inclusive YYYY-MM-DD day list (UTC date math on calendar strings). */
function eachDateInclusive(start, end) {
  const out = [];
  const s = isoDate(start);
  const e = isoDate(end);
  const cur = new Date(s + 'T12:00:00Z');
  const last = new Date(e + 'T12:00:00Z');
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * List bookings for a venue.
 * Prefer per-day `?date=` — FourVenues `start_date`/`end_date` often returns a
 * truncated/incomplete set (e.g. Marian 7/25 showed ~$3k instead of $13.5k accepted).
 */
async function listBookings(venue, { start, end, date } = {}) {
  const apiKey = getApiKey(venue);
  if (!apiKey) throw new Error(`Missing ${venue.envKey} for ${venue.name}`);

  if (date) {
    const data = await apiGet(apiKey, `/bookings/?date=${encodeURIComponent(isoDate(date))}`);
    return { venue: venue.name, venueKey: venue.key, bookings: data.data || [] };
  }

  const range = { start: start || defaultDateRange().start, end: end || defaultDateRange().end };
  const days = eachDateInclusive(range.start, range.end);
  const byId = new Map();
  for (const day of days) {
    const data = await apiGet(apiKey, `/bookings/?date=${encodeURIComponent(day)}`);
    for (const b of data.data || []) {
      const id = b._id || b.id || `${b.event_id}|${b.date}|${b.price}|${b.status}|${b.local_date}`;
      byId.set(id, b);
    }
  }
  return { venue: venue.name, venueKey: venue.key, bookings: [...byId.values()] };
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

/** Art Basel at Casa Neos Beach Club: Friday–Sunday. */
const BASEL_TRACKER = {
  venueKey: 'casa_neos_bc',
  label: 'Art Basel',
  dates: ['2026-12-04', '2026-12-05', '2026-12-06']
};

function referrerDisplayName(user) {
  const profile = (user && user.profile) || {};
  const first = String(profile.name || '').trim();
  const last = String(profile.last_name || '').trim();
  if (first && last && first.toLowerCase().indexOf(last.toLowerCase()) === -1) return (first + ' ' + last).trim();
  return first || last || '';
}

/**
 * Basel Fri–Sun sales, same rule as forecast (accepted + not-completed price),
 * plus a breakdown by FourVenues referrer (referral_id → user name).
 */
async function getBaselTracker() {
  const venue = VENUES.find(v => v.key === BASEL_TRACKER.venueKey);
  if (!venue) throw new Error('Basel venue missing');
  const apiKey = getApiKey(venue);
  if (!apiKey) throw new Error(`Missing ${venue.envKey}`);
  const usersData = await apiGet(apiKey, '/users/');
  const names = new Map();
  for (const user of (usersData && usersData.data) || []) {
    const label = referrerDisplayName(user);
    if (user && user._id && label) names.set(user._id, label);
  }
  const nights = [];
  const refMap = new Map();
  for (const date of BASEL_TRACKER.dates) {
    const { bookings } = await listBookings(venue, { date });
    const keep = (bookings || []).filter(b => isCountableStatus(b.status || b.state));
    const djs = [...new Set(keep.map(b => String(b.event_name || '').trim()).filter(Boolean))];
    let revenue = 0;
    for (const b of keep) {
      const price = Number(b.price) || 0;
      revenue += price;
      const name = (b.referral_id && names.get(b.referral_id)) || 'No referrer';
      if (!refMap.has(name)) refMap.set(name, { name, totalRevenue: 0, bookings: 0, byDate: {} });
      const group = refMap.get(name);
      group.totalRevenue += price;
      group.bookings += 1;
      if (!group.byDate[date]) group.byDate[date] = { revenue: 0, bookings: 0 };
      group.byDate[date].revenue += price;
      group.byDate[date].bookings += 1;
    }
    nights.push({
      date,
      dj: djs.join(' / ') || 'TBD',
      totalRevenue: Math.round(revenue * 100) / 100,
      bookings: keep.length
    });
  }
  const referrers = [...refMap.values()].map(group => ({
    name: group.name,
    totalRevenue: Math.round(group.totalRevenue * 100) / 100,
    bookings: group.bookings,
    byDate: Object.fromEntries(Object.entries(group.byDate).map(([date, cell]) => [date, {
      revenue: Math.round(cell.revenue * 100) / 100,
      bookings: cell.bookings
    }]))
  })).sort((a, b) => (b.totalRevenue - a.totalRevenue) || a.name.localeCompare(b.name));
  return {
    updatedAt: new Date().toISOString(),
    venue: venue.name,
    label: BASEL_TRACKER.label,
    dates: BASEL_TRACKER.dates.slice(),
    methodology: 'FourVenues price · accepted + not completed',
    totalRevenue: Math.round(nights.reduce((sum, night) => sum + night.totalRevenue, 0) * 100) / 100,
    totalBookings: nights.reduce((sum, night) => sum + night.bookings, 0),
    nights,
    referrers
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
  getBaselTracker,
  isCountableStatus,
  defaultDateRange,
  isoDate,
  eachDateInclusive
};
