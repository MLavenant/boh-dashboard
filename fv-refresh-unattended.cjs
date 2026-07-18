/**
 * Unattended FourVenues Forecast refresh (no login / no Outlook required).
 *
 * - Scrapes booking maps with Playwright (headless when FV_UNATTENDED=1)
 * - BS Actual = Sales-export-equivalent math: Last 7 days × Base price × Accepted/Not completed
 *   (same numbers as your Excel for KAZ — proven $27K)
 * - Writes Firebase rdg/forecastLive + pacing so ALL users see live Forecast without git push
 * - Still updates local index.html and pushes to GitHub when credentials are available
 *
 * Usage:
 *   set FV_UNATTENDED=1
 *   node fv-refresh-unattended.cjs
 */
'use strict';

process.env.FV_UNATTENDED = '1';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { buildForecastFromMaps, summarizeMapData, salesPeriodLast7Days } = require('./fv-sales-period.cjs');

const DASHBOARD_PATH = 'C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html';
const SESSION_PATH = 'C:\\Cursor\\toast-mcp-server\\fv-final-session.json';
const DATA_PATH = 'C:\\Cursor\\toast-mcp-server\\fv-bookings-data.json';
const FB_DB = 'rdg-dj-dashboard-default-rtdb.firebaseio.com';

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
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`[${ts}] ${msg}`);
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

async function dismissPopups(page) {
  try {
    const darkModal = page.getByText(/dark mode available/i).first();
    if (await darkModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.getByText(/Interface in dark tones/i).first().click().catch(() => {});
      await page.getByRole('button', { name: /^Accept$/i }).click().catch(() => {});
      await page.waitForTimeout(600);
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
  await page.goto(bookingUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
  await dismissPopups(page);
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

function replaceForecastInHtml(results) {
  const newDataJS = 'var FORECAST_DATA = [\n' +
    results.map(r => '  ' + JSON.stringify(r)).join(',\n') +
    '\n];';
  const htmlRaw = fs.readFileSync(DASHBOARD_PATH, 'latin1');
  const startToken = 'var FORECAST_DATA = [';
  const start = htmlRaw.indexOf(startToken);
  if (start < 0) throw new Error('FORECAST_DATA not found');
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
  if (end < 0) throw new Error('FORECAST_DATA end not found');
  fs.writeFileSync(DASHBOARD_PATH, htmlRaw.slice(0, start) + newDataJS + htmlRaw.slice(end), 'latin1');
}

function tryGitPush(message) {
  const dashDir = path.dirname(DASHBOARD_PATH);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  try {
    if (token) {
      execSync(
        `git -C "${dashDir}" add index.html && git -C "${dashDir}" commit -m "${message}" && ` +
        `git -C "${dashDir}" -c http.extraHeader="AUTHORIZATION: bearer ${token}" push origin main`,
        { stdio: 'inherit', shell: 'cmd.exe' }
      );
    } else {
      execSync(
        `git -C "${dashDir}" add index.html && git -C "${dashDir}" commit -m "${message}" && git -C "${dashDir}" push origin main`,
        { stdio: 'inherit', shell: 'cmd.exe' }
      );
    }
    log('✅ GitHub Pages push OK');
    return true;
  } catch (e) {
    log('Git push skipped/failed (Firebase live still updated): ' + (e.message || '').split('\n')[0]);
    return false;
  }
}

(async () => {
  log('=== UNATTENDED FourVenues Forecast Refresh ===');
  if (!fs.existsSync(SESSION_PATH)) throw new Error('Missing FV session: ' + SESSION_PATH);

  const headless = process.env.FV_HEADLESS !== '0';
  const browser = await chromium.launch({
    headless,
    args: headless
      ? ['--disable-blink-features=AutomationControlled']
      : ['--window-size=1,1', '--window-position=-9999,0', '--disable-infobars']
  });
  const sd = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
  const ctx = await browser.newContext({ storageState: sd.storageState || sd });
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  log('Warming session…');
  await page.goto('https://pro.fourvenues.com/mila1/reports/sales-overview', {
    waitUntil: 'domcontentloaded', timeout: 45000
  }).catch(() => {});
  await dismissPopups(page);
  await page.waitForTimeout(2500);

  const todaySec = Math.floor(Date.now() / 1000);
  const allData = {};

  for (const v of VENUES) {
    log(`\nScraping ${v.name}…`);
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
      const icon = mapData ? '✅' : '⚪';
      const rev = summary ? ` $${summary.totalRevenue.toLocaleString()}` : '';
      log(`  ${icon} ${evDate} ${evt.nombre}${rev}`);
      eventsData.push({ date: evDate, name: evt.nombre, id: evt._id, mapData, kpiData });
    }
    allData[v.name] = eventsData;
  }

  await browser.close();
  fs.writeFileSync(DATA_PATH, JSON.stringify(allData, null, 2));

  const { results, period } = buildForecastFromMaps(allData);
  results.forEach(r => { r._source = 'sales_period_unattended'; });
  log(`\nPeriod ${period.date_from} → ${period.date_until}: ${results.filter(r => r.totalRevenue > 0).length} events with $`);

  // Firebase live feed (works for every viewer even if Pages not pushed)
  const today = miamiToday();
  const livePayload = {
    updatedAt: new Date().toISOString(),
    miamiDay: today,
    period,
    source: 'sales_period_unattended',
    events: {}
  };
  for (const r of results) {
    const key = (r.venue + '_' + r.date).replace(/[^a-zA-Z0-9_-]/g, '_');
    livePayload.events[key] = {
      venue: r.venue,
      date: r.date,
      dj: r.dj,
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
      source: 'sales_period_unattended'
    });
  }
  const liveCode = await fbPut('/rdg/forecastLive', livePayload);
  log(`Firebase forecastLive HTTP ${liveCode} (${Object.keys(livePayload.events).length} events)`);

  try {
    replaceForecastInHtml(results);
    log('Updated local index.html FORECAST_DATA');
    const label = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    tryGitPush(`Auto-refresh (unattended): FourVenues forecast — ${label}`);
  } catch (e) {
    log('Local HTML update note: ' + e.message);
  }

  try {
    execSync(
      `node "${__dirname}\\fb-scrape-status.cjs" fourvenues ok "Unattended: ${results.length} events, period export math"`,
      { stdio: 'inherit', shell: 'cmd.exe' }
    );
  } catch (_) {}

  // Toast BS still useful after FV (API-based — works unattended)
  try {
    log('\n--- Toast BS Actual (unattended) ---');
    execSync(`node "${__dirname}\\toast-bs-update.cjs"`, { stdio: 'inherit', shell: 'cmd.exe', cwd: __dirname });
  } catch (e) {
    log('Toast BS note: ' + (e.message || '').split('\n')[0]);
  }

  log('\n=== UNATTENDED FourVenues Complete ===');
  results.filter(r => r.totalRevenue > 0).forEach(r =>
    log(`  ${r.venue} | ${r.date} | ${r.dj} | $${r.totalRevenue.toLocaleString()}`)
  );
})().catch(e => {
  console.error(e);
  try {
    execSync(
      `node "${__dirname}\\fb-scrape-status.cjs" fourvenues fail "${String(e.message || e).replace(/"/g, '').slice(0, 120)}"`,
      { stdio: 'inherit', shell: 'cmd.exe' }
    );
  } catch (_) {}
  process.exit(1);
});
