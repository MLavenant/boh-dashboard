/**
 * Cloud FourVenues Forecast via Microsoft Graph mailbox (laptop OFF).
 *
 * Reads newest "Sales Report" emails from GRAPH_MAILBOX, parses Base price
 * (Accepted + Not completed), writes Firebase rdg/forecastLive + scrapeStatus.
 *
 * Required env (GitHub Actions secrets):
 *   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, GRAPH_MAILBOX
 *
 * Usage:
 *   node fv-refresh-graph.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { parseSalesExportFile, VENUES } = require('./fv-sales-export-lib.cjs');
const { downloadLatestSalesReports } = require('./ms-graph-mail.cjs');

const FB_DB = 'rdg-dj-dashboard-default-rtdb.firebaseio.com';
const OUT_DIR = process.env.FV_OUT_DIR || path.join(__dirname, 'fv-exports');

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

function buildLiveFromExports(parsedByVenue) {
  const today = miamiToday();
  const livePayload = {
    updatedAt: new Date().toISOString(),
    miamiDay: today,
    source: 'sales_export_graph',
    period: { label: 'Sales Report email (Graph)', date_from: null, date_until: null },
    events: {},
    emailMeta: {}
  };

  // Match dashboard listener key: venue_date. Prefer DJ-specific when possible via secondary keys.
  for (const row of parsedByVenue) {
    livePayload.emailMeta[row.venueKey] = {
      emailReceivedAt: row.emailReceivedAt || null,
      emailAgeHours: row.emailAgeHours != null ? row.emailAgeHours : null,
      error: row.error || null,
      events: row.byEvent ? row.byEvent.length : 0
    };
    if (row.error || !row.byEvent) continue;
    for (const ev of row.byEvent) {
      if (!ev.date) continue;
      const totalRevenue = Math.round(ev.basePrice || 0);
      const bookedTables = ev.bookings || 0;
      const payload = {
        venue: row.venue,
        date: ev.date,
        dj: ev.event,
        totalRevenue,
        bookedTables,
        hasData: true,
        _source: 'sales_export_graph'
      };
      const keyDate = (row.venue + '_' + ev.date).replace(/[^a-zA-Z0-9_-]/g, '_');
      const keyDj = (row.venue + '_' + ev.date + '_' + String(ev.event || '')).replace(/[^a-zA-Z0-9_-]/g, '_');
      livePayload.events[keyDj] = payload;
      const prev = livePayload.events[keyDate];
      if (!prev || (prev.totalRevenue || 0) < totalRevenue) {
        livePayload.events[keyDate] = payload;
      }
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
  log('=== FourVenues Forecast via Microsoft Graph ===');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sinceMs = process.env.GRAPH_SINCE_MS ? Number(process.env.GRAPH_SINCE_MS) : null;
  const { messagesFound, results, mailbox } = await downloadLatestSalesReports({
    venues: VENUES,
    outDir: OUT_DIR,
    maxAgeDays: Number(process.env.GRAPH_MAX_AGE_DAYS || 14),
    sinceMs: Number.isFinite(sinceMs) ? sinceMs : null
  });
  if (mailbox) {
    log(`Mailbox UPN=${mailbox.userPrincipalName} mail=${mailbox.mail || '(none)'}`);
  }
  log(`Inbox Sales Report candidates: ${messagesFound}`);

  const parsedByVenue = [];
  for (const r of results) {
    if (r.error) {
      log(`  ✗ ${r.venue}: ${r.error}`);
      parsedByVenue.push(r);
      continue;
    }
    log(`  ✓ ${r.venue}: email ${r.emailReceivedAt} (age ${r.emailAgeHours}h) → ${path.basename(r.outFile)} (${r.size} bytes)`);
    try {
      const parsed = parseSalesExportFile(r.outFile);
      const sum = parsed.byEvent.reduce((s, e) => s + e.basePrice, 0);
      log(`    sheet=${parsed.sheetName} events=${parsed.byEvent.length} base=$${Math.round(sum).toLocaleString()}`);
      parsedByVenue.push({ ...r, ...parsed });
    } catch (e) {
      log(`    parse failed: ${e.message}`);
      parsedByVenue.push({ ...r, error: 'Parse: ' + e.message, byEvent: [] });
    }
  }

  const okVenues = parsedByVenue.filter(r => !r.error && r.byEvent && r.byEvent.length);
  if (!okVenues.length) {
    const msg = 'No usable Sales Report emails (check Azure Mail.Read + mailbox has recent FourVenues Sales Report)';
    await fbPut('/rdg/scrapeStatus/fourvenues', {
      ok: false,
      at: new Date().toISOString(),
      atLocal: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
      schedule: 'Daily ~8:30 AM ET · Export trigger + Microsoft Graph',
      what: 'FourVenues Sales Report email → Firebase forecastLive',
      message: msg
    });
    throw new Error(msg);
  }

  const { livePayload, eventCount, revenueSum } = buildLiveFromExports(parsedByVenue);
  const code = await fbPut('/rdg/forecastLive', livePayload);
  log(`Firebase forecastLive HTTP ${code} · ${eventCount} events · $${Math.round(revenueSum).toLocaleString()}`);

  const today = miamiToday();
  for (const [key, ev] of Object.entries(livePayload.events)) {
    await fbPut(`/rdg/pacing/${key}/${today}`, {
      tables: ev.bookedTables || 0,
      revenue: ev.totalRevenue || 0,
      source: 'sales_export_graph'
    });
  }

  const oldestAge = Math.max(...okVenues.map(v => v.emailAgeHours || 0));
  const stale = oldestAge > 36;
  const statusMsg = stale
    ? `OK but emails up to ${oldestAge}h old — export trigger may have failed`
    : `Graph OK: ${okVenues.length}/${VENUES.length} venues, ${eventCount} events`;

  await fbPut('/rdg/scrapeStatus/fourvenues', {
    ok: !stale,
    at: new Date().toISOString(),
    atLocal: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    schedule: 'Daily ~8:30 AM ET · Export trigger + Microsoft Graph',
    what: 'FourVenues Sales Overview Export email → Firebase forecastLive',
    message: statusMsg,
    emailAgeHoursMax: oldestAge,
    venuesOk: okVenues.length
  });

  log(statusMsg);
  log('=== Done ===');
  if (stale) process.exit(0); // soft: data written, Sanity warns
})().catch(async (e) => {
  console.error(e);
  try {
    await fbPut('/rdg/scrapeStatus/fourvenues', {
      ok: false,
      at: new Date().toISOString(),
      atLocal: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
      schedule: 'Daily ~8:30 AM ET · Export trigger + Microsoft Graph',
      what: 'FourVenues Sales Overview Export email → Firebase forecastLive',
      message: String(e.message || e).slice(0, 200)
    });
  } catch (_) {}
  process.exit(1);
});
