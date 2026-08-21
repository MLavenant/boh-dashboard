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

function fbGet(fbPath) {
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: FB_DB,
      path: fbPath + '.json',
      method: 'GET'
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode < 200 || r.statusCode >= 300) {
          return rej(new Error(`Firebase GET ${fbPath} returned HTTP ${r.statusCode}`));
        }
        try {
          res(d ? JSON.parse(d) : null);
        } catch (e) {
          rej(new Error(`Firebase GET ${fbPath} returned invalid JSON: ${e.message}`));
        }
      });
    });
    req.on('error', rej);
    req.end();
  });
}

async function withFbRetry(fn, label, retries = 4) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const code = e && e.code;
      const transient = code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
      if (!transient || attempt >= retries) break;
      const wait = 300 * attempt;
      log(`Firebase ${label} retry ${attempt}/${retries} after ${code || e.message} (wait ${wait}ms)`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function fbPutRetry(fbPath, payload) {
  return withFbRetry(() => fbPut(fbPath, payload), 'PUT ' + fbPath);
}

async function fbGetRetry(fbPath) {
  return withFbRetry(() => fbGet(fbPath), 'GET ' + fbPath);
}

async function writePacingSnapshots(forecastRows) {
  const snapshotDay = miamiToday();
  const events = new Map();

  for (const r of forecastRows || []) {
    if (!r.date || !r.venue) continue;
    const key = (r.venue + '_' + r.date).replace(/[^a-zA-Z0-9_-]/g, '_');
    const revenue = Math.round(Number(r.totalRevenue) || 0);
    const existing = events.get(key);
    if (!existing || revenue > existing.revenue) {
      events.set(key, {
        key,
        venue: r.venue,
        date: r.date,
        revenue,
        tables: Number(r.bookings) || 0
      });
    }
  }

  let created = 0;
  let preserved = 0;
  let failed = 0;
  /* Sequential (not Promise.all) — parallel Firebase writes caused ECONNRESET on Actions. */
  for (const event of events.values()) {
    const fbPath = `/rdg/pacing/${event.key}/${snapshotDay}`;
    try {
      const existing = await fbGetRetry(fbPath);

      // The first accurate API read of each Miami day is the immutable
      // beginning-of-day baseline. A later backup run must not move it.
      if (existing && existing.source === 'integrations_api'
          && Number.isFinite(Number(existing.revenue))
          && Number.isFinite(Number(existing.tables))) {
        preserved++;
        continue;
      }

      const status = await fbPutRetry(fbPath, {
        tables: event.tables,
        revenue: event.revenue,
        source: 'integrations_api',
        capturedAt: new Date().toISOString()
      });
      if (status < 200 || status >= 300) {
        throw new Error(`Firebase PUT ${fbPath} returned HTTP ${status}`);
      }
      created++;
    } catch (e) {
      failed++;
      log(`Pacing skip ${event.key}: ${e.code || e.message}`);
    }
  }

  return { day: snapshotDay, events: events.size, created, preserved, failed };
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
    await fbPutRetry('/rdg/scrapeStatus/fourvenues', {
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
    await fbPutRetry('/rdg/scrapeStatus/fourvenues', {
      ok: false,
      at: new Date().toISOString(),
      miamiDay: miamiToday(),
      error: pulled.errors.map(e => `${e.venue}: ${e.error}`).join(' | '),
      what: 'FourVenues Integrations API → Firebase forecastLive'
    });
    throw new Error('All venue API pulls failed');
  }

  let pacing = { day: miamiToday(), events: 0, created: 0, preserved: 0, failed: 0 };
  try {
    pacing = await writePacingSnapshots(pulled.forecastRows);
    log(`Firebase pacing ${pacing.day}: ${pacing.created} created · ${pacing.preserved} preserved · ${pacing.failed || 0} failed · ${pacing.events} events`);
  } catch (e) {
    log(`Pacing non-fatal: ${e.code || e.message}`);
  }

  const code = await fbPutRetry('/rdg/forecastLive', livePayload);
  log(`Firebase forecastLive HTTP ${code} · ${eventCount} events · $${Math.round(revenueSum).toLocaleString()}`);

  const statusCode = await fbPutRetry('/rdg/scrapeStatus/fourvenues', {
    ok: true,
    at: new Date().toISOString(),
    miamiDay: miamiToday(),
    eventCount,
    revenueSum: Math.round(revenueSum),
    pacing,
    period: pulled.period,
    errors: pulled.errors || [],
    schedule: 'Punctual dispatch ~8:25 ET · GitHub schedule = late backup · retries 9:00/9:30',
    what: 'FourVenues Integrations API (accepted + not-completed price) → Firebase forecastLive'
  });
  log(`Firebase scrapeStatus/fourvenues HTTP ${statusCode}`);
  log('Done.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
