/**
 * Cloud / GitHub Actions FourVenues Forecast refresh.
 * Uses Playwright + FV_SESSION_JSON secret, writes Firebase rdg/forecastLive.
 * No Outlook. Laptop can be OFF.
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { buildForecastFromMaps, summarizeMapData, salesPeriodLast7Days } = require('./fv-sales-period.cjs');

const FB_DB = 'rdg-dj-dashboard-default-rtdb.firebaseio.com';
const SESSION_PATH = process.env.FV_SESSION_PATH || path.join(__dirname, 'fv-final-session.json');
const DATA_PATH = process.env.FV_DATA_PATH || path.join(__dirname, 'fv-bookings-data.json');
const DASHBOARD_PATH = process.env.DASHBOARD_PATH || '';

const APP_HDR = {
  'storage-bucket': 'pro',
  referer: 'https://pro.fourvenues.com/',
  'device-id': 'Q529vp56m4h2q395ia0i6xt0csuPejE3',
  accept: 'application/json, text/plain, */*',
  'content-type': 'application/json',
  'app-id': 'ajihln7fc0006jhmmi4lh75s2lI9O3jx',
};

const VENUES = [
  { name: 'Casa Neos Beach Club', id: 'lah0f2isk8qmsg0zapu016rarffvp0xz', slug: 'casa-neos1' },
  { name: 'MILA Lounge', id: 'Mmgkyvi0903mo01cm3vxg0phrtTEPpSM', slug: 'mila1' },
  { name: 'Casa Neos Lounge', id: 'mrph20a941lojvdykvq598p0b8j3576j', slug: 'casa-neos-lounge' },
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function miamiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function loadSession() {
  const tryParse = (buf) => {
    let raw = buf;
    if (Buffer.isBuffer(buf) && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      raw = require('zlib').gunzipSync(buf);
    }
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    return JSON.parse(text);
  };
  if (process.env.FV_SESSION_B64) {
    return tryParse(Buffer.from(process.env.FV_SESSION_B64, 'base64'));
  }
  if (process.env.FV_SESSION_JSON) {
    return JSON.parse(process.env.FV_SESSION_JSON);
  }
  if (!fs.existsSync(SESSION_PATH)) throw new Error('Missing FV session. Set FV_SESSION_B64 secret or file.');
  const fileBuf = fs.readFileSync(SESSION_PATH);
  try {
    return tryParse(fileBuf);
  } catch (_) {
    return JSON.parse(fileBuf.toString('utf8'));
  }
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

async function dismissPopups(page) {
  try {
    const darkModal = page.getByText(/dark mode available/i).first();
    if (await darkModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.getByText(/Interface in dark tones/i).first().click().catch(() => {});
      await page.getByRole('button', { name: /^Accept$/i }).click().catch(() => {});
      await page.waitForTimeout(500);
    }
  } catch (_) {}
  await page.getByRole('button', { name: /^Accept$/i }).click({ timeout: 800 }).catch(() => {});
}

async function scrapeEventBookings(page, slug, eventId) {
  const bookingUrl = `https://pro.fourvenues.com/${slug}/${eventId}/sales/bookings`;
  const captured = {};
  const handler = async (r) => {
    const u = r.url();
    if (!u.includes('api.fourvenues.com') || r.status() !== 200) return;
    if (u.includes('listado_reservados_mapa') || u.includes('reservados_mapa') ||
        u.includes('listado_bookings_kpis') || u.includes('bookings_kpis')) {
      const body = await r.text().catch(() => '');
      if (body.length > 10) captured[u] = body;
    }
  };
  page.on('response', handler);
  await page.goto(bookingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await dismissPopups(page);
  await page.waitForTimeout(4500);
  // One reload often needed for listado
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);
  page.off('response', handler);

  let mapData = null, kpiData = null;
  for (const [url, body] of Object.entries(captured)) {
    try {
      if (url.includes('listado_reservados_mapa')) mapData = JSON.parse(body);
      else if (!mapData && url.includes('reservados_mapa')) mapData = JSON.parse(body);
      if (url.includes('bookings_kpis')) kpiData = JSON.parse(body);
    } catch (_) {}
  }
  return { mapData, kpiData };
}

function replaceForecastInHtml(results, dashPath) {
  if (!dashPath || !fs.existsSync(dashPath)) return false;
  const newDataJS = 'var FORECAST_DATA = [\n' +
    results.map(r => '  ' + JSON.stringify(r)).join(',\n') +
    '\n];';
  const htmlRaw = fs.readFileSync(dashPath, 'latin1');
  const startToken = 'var FORECAST_DATA = [';
  const start = htmlRaw.indexOf(startToken);
  if (start < 0) return false;
  let depth = 0, end = -1;
  for (let i = start + startToken.length - 1; i < htmlRaw.length; i++) {
    if (htmlRaw[i] === '[') depth++;
    else if (htmlRaw[i] === ']') {
      depth--;
      if (depth === 0) {
        end = htmlRaw[i + 1] === ';' ? i + 2 : i + 1;
        break;
      }
    }
  }
  if (end < 0) return false;
  fs.writeFileSync(dashPath, htmlRaw.slice(0, start) + newDataJS + htmlRaw.slice(end), 'latin1');
  return true;
}

(async () => {
  log('=== CLOUD FourVenues Forecast Refresh ===');
  const sd = loadSession();
  const headless = process.env.FV_HEADLESS !== '0';

  const browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });
  const ctx = await browser.newContext({ storageState: sd.storageState || sd });
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  log('Warming session…');
  await page.goto('https://pro.fourvenues.com/mila1/reports/sales-overview', {
    waitUntil: 'domcontentloaded', timeout: 60000
  }).catch(() => {});
  await dismissPopups(page);
  await page.waitForTimeout(2500);

  const todaySec = Math.floor(Date.now() / 1000);
  const allData = {};

  for (const v of VENUES) {
    log(`Scraping ${v.name}…`);
    const evQ = JSON.stringify({ negocio_id: v.id, eliminado: 0, cancelado: 0, fecha: { $gte: todaySec - 86400 } });
    const evR = await ctx.request.get(
      'https://api.fourvenues.com/eventos/?query=' + encodeURIComponent(evQ) +
      '&options=' + encodeURIComponent(JSON.stringify({ limit: 50, sort: { fecha: 1 } })),
      { headers: APP_HDR }
    );
    let events = [];
    try { events = (await evR.json()).data || []; } catch (_) {}
    log(`  ${events.length} events`);

    const eventsData = [];
    for (const evt of events) {
      const evDate = new Date(evt.fecha * 1000).toISOString().split('T')[0];
      const { mapData, kpiData } = await scrapeEventBookings(page, v.slug, evt._id);
      const summary = mapData ? summarizeMapData(mapData, salesPeriodLast7Days()) : null;
      log(`  ${mapData ? 'OK' : '--'} ${evDate} ${evt.nombre}${summary ? ' $' + summary.totalRevenue : ''}`);
      eventsData.push({ date: evDate, name: evt.nombre, id: evt._id, mapData, kpiData });
    }
    allData[v.name] = eventsData;
  }

  await browser.close();
  fs.writeFileSync(DATA_PATH, JSON.stringify(allData, null, 2));

  const { results, period } = buildForecastFromMaps(allData);
  results.forEach(r => { r._source = 'sales_period_cloud'; });
  const with$ = results.filter(r => r.totalRevenue > 0);
  log(`Period ${period.date_from}→${period.date_until}: ${with$.length} events with revenue`);

  const today = miamiToday();
  const livePayload = {
    updatedAt: new Date().toISOString(),
    miamiDay: today,
    period,
    source: 'sales_period_cloud',
    events: {}
  };
  for (const r of results) {
    const key = (r.venue + '_' + r.date).replace(/[^a-zA-Z0-9_-]/g, '_');
    livePayload.events[key] = {
      venue: r.venue, date: r.date, dj: r.dj,
      totalRevenue: Math.round(r.totalRevenue || 0),
      bookedTables: r.bookedTables || 0,
      totalTables: r.totalTables || 0,
      tierSummary: r.tierSummary || {},
      hasData: !!r.hasData,
      _source: r._source
    };
    await fbPut(`/rdg/pacing/${key}/${today}`, {
      tables: r.bookedTables || 0,
      revenue: Math.round(r.totalRevenue || 0),
      source: 'sales_period_cloud'
    });
  }
  const code = await fbPut('/rdg/forecastLive', livePayload);
  log(`Firebase forecastLive HTTP ${code}`);

  if (DASHBOARD_PATH) {
    const ok = replaceForecastInHtml(results, DASHBOARD_PATH);
    log(ok ? 'Updated dashboard FORECAST_DATA' : 'Dashboard HTML not updated');
  }

  const now = new Date();
  await fbPut('/rdg/scrapeStatus/fourvenues', {
    ok: with$.length > 0,
    at: now.toISOString(),
    atLocal: now.toLocaleString('en-US', { timeZone: 'America/New_York' }),
    schedule: 'Daily ~8:30 AM ET (GitHub Actions)',
    what: 'FourVenues Sales-period Base price (Accepted + Not completed) → Firebase forecastLive',
    message: `Cloud: ${results.length} events, ${with$.length} with $`,
    events: results.length,
    withRevenue: with$.length
  }).catch(() => {});

  with$.forEach(r => log(`  ${r.venue} | ${r.date} | ${r.dj} | $${r.totalRevenue}`));
  if (with$.length === 0) {
    console.error('WARNING: zero revenue events — session may be expired or Cloudflare blocked');
    process.exitCode = 2;
  }
  log('=== CLOUD FourVenues Complete ===');
})().catch(async (e) => {
  console.error(e);
  try {
    const now = new Date();
    await fbPut('/rdg/scrapeStatus/fourvenues', {
      ok: false,
      at: now.toISOString(),
      atLocal: now.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      schedule: 'Daily ~8:30 AM ET (GitHub Actions)',
      what: 'FourVenues Sales-period Base price → Firebase forecastLive',
      message: String(e.message || e).slice(0, 200)
    });
  } catch (_) {}
  process.exit(1);
});
