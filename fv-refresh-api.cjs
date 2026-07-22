/**
 * Daily FourVenues Forecast via Integrations API (laptop OFF).
 *
 * Pulls bookings for MILA / Casa Neos Lounge / Beach Club, sums price for
 * accepted + not-completed, writes Firebase rdg/forecastLive + scrapeStatus.
 *
 * Required env (GitHub Actions secrets):
 *   FV_API_KEY_MILA
 *   FV_API_KEY_CASA_NEOS
 *   FV_API_KEY_CASA_NEOS_BC
 *
 * Usage:
 *   node fv-refresh-api.cjs
 */
'use strict';

const https = require('https');
const { getForecastActuals, venuesWithKeys } = require('./fv-api-client.cjs');

const FB_DB = 'rdg-dj-dashboard-default-rtdb.firebaseio.com';

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function miamiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function fbPut(fbPath, payload) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: FB_DB,
      path: fbPath + '.json',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res(r.statusCode));
    });
    req.on('error', rej);
    req.write(body);
    req.end();
  });
}

function buildLivePayload(forecastRows, period) {
  const today = miamiToday();
  const livePayload = {
    updatedAt: new Date().toISOString(),
    miamiDay: today,
    source: 'integrations_api',
    period: period || { label: 'Integrations API bookings (accepted + not-completed price)' },
    events: {},
    perVenue: {}
  };

  for (const r of forecastRows || []) {
    if (!r.date || !r.venue) continue;
    const totalRevenue = Math.round(Number(r.totalRevenue) || 0);
    const payload = {
      venue: r.venue,
      date: r.date,
      dj: r.dj,
      totalRevenue,
      bookedTables: r.bookings || 0,
      hasData: true,
      _source: 'integrations_api'
    };
    const keyDate = (r.venue + '_' + r.date).replace(/[^a-zA-Z0-9_-]/g, '_');
    const keyDj = (r.venue + '_' + r.date + '_' + String(r.dj || '')).replace(/[^a-zA-Z0-9_-]/g, '_');
    livePayload.events[keyDj] = payload;
    const prev = livePayload.events[keyDate];
    if (!prev || (prev.totalRevenue || 0) < totalRevenue) {
      livePayload.events[keyDate] = payload;
    }
  }

  const seen = new Set();
  let eventCount = 0;
  let revenueSum = 0;
  for (const e of Object.values(livePayload.events)) {
    const id = `${e.venue}|${e.date}|${e.dj}`;
    if (seen.has(id)) continue;
    seen.add(id);
    eventCount++;
    revenueSum += e.totalRevenue || 0;
  }
  return { livePayload, eventCount, revenueSum };
}

(async () => {
  log('=== FourVenues Forecast via Integrations API ===');
  const ready = venuesWithKeys({ includeOptional: false });
  log(`API keys present: ${ready.map(v => v.key).join(', ') || '(none)'}`);
  if (!ready.length) {
    throw new Error('Missing FV_API_KEY_MILA / FV_API_KEY_CASA_NEOS / FV_API_KEY_CASA_NEOS_BC');
  }

  let pulled;
  try {
    pulled = await getForecastActuals({ venue: 'all' });
  } catch (e) {
    await fbPut('/rdg/scrapeStatus/fourvenues', {
      ok: false,
      at: new Date().toISOString(),
      miamiDay: miamiToday(),
      error: e.message,
      what: 'FourVenues Integrations API → Firebase forecastLive'
    });
    throw e;
  }

  for (const err of pulled.errors || []) {
    log(`ERROR ${err.venue}: ${err.error}`);
  }
  for (const pv of pulled.perVenue || []) {
    log(`${pv.venue}: ${pv.bookingCount} bookings → ${pv.eventCount} events · $${Math.round(pv.revenueSum).toLocaleString()}`);
  }

  const { livePayload, eventCount, revenueSum } = buildLivePayload(pulled.forecastRows, pulled.period);
  for (const pv of pulled.perVenue || []) {
    livePayload.perVenue[pv.venueKey] = pv;
  }

  const hardFail = (pulled.errors || []).length >= ready.length;
  if (hardFail) {
    await fbPut('/rdg/scrapeStatus/fourvenues', {
      ok: false,
      at: new Date().toISOString(),
      miamiDay: miamiToday(),
      error: pulled.errors.map(e => `${e.venue}: ${e.error}`).join(' | '),
      what: 'FourVenues Integrations API → Firebase forecastLive'
    });
    throw new Error('All venue API pulls failed');
  }

  const code = await fbPut('/rdg/forecastLive', livePayload);
  log(`Firebase forecastLive HTTP ${code} · ${eventCount} events · $${Math.round(revenueSum).toLocaleString()}`);

  const statusCode = await fbPut('/rdg/scrapeStatus/fourvenues', {
    ok: true,
    at: new Date().toISOString(),
    miamiDay: miamiToday(),
    eventCount,
    revenueSum: Math.round(revenueSum),
    period: pulled.period,
    errors: pulled.errors || [],
    what: 'FourVenues Integrations API (accepted + not-completed price) → Firebase forecastLive'
  });
  log(`Firebase scrapeStatus/fourvenues HTTP ${statusCode}`);
  log('Done.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
