/**
 * FourVenues → Firebase rdg/baselTracker only.
 * Does not write forecastLive or the daily FourVenues status.
 *
 *   node fv-refresh-basel.cjs
 */
'use strict';

const https = require('https');
const { getBaselTracker, venuesWithKeys } = require('./fv-api-client.cjs');

const FB_DB = 'rdg-dj-dashboard-default-rtdb.firebaseio.com';

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
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
      r.on('end', () => {
        if (r.statusCode < 200 || r.statusCode >= 300) {
          return rej(new Error(`Firebase PUT ${fbPath} HTTP ${r.statusCode} ${d.slice(0, 180)}`));
        }
        res(r.statusCode);
      });
    });
    req.on('error', rej);
    req.write(body);
    req.end();
  });
}

(async () => {
  log('=== FourVenues Basel tracker only ===');
  const ready = venuesWithKeys({ includeOptional: false });
  log(`API keys present: ${ready.map(v => v.key).join(', ') || '(none)'}`);
  if (!ready.length) {
    throw new Error('Missing FV_API_KEY_MILA / FV_API_KEY_CASA_NEOS / FV_API_KEY_CASA_NEOS_BC');
  }

  const basel = await getBaselTracker();
  for (const err of basel.errors || []) log(`ERROR ${err.name}: ${err.error}`);
  if ((basel.errors || []).length) {
    throw new Error('Basel tracker left a venue out, so Firebase was not updated');
  }
  for (const v of basel.venues || []) {
    log(`${v.name}: ${v.totalBookings} tables · $${Math.round(v.totalRevenue).toLocaleString()} · ${(v.nights || []).length} nights`);
  }

  const code = await fbPut('/rdg/baselTracker', basel);
  log(`Firebase baselTracker HTTP ${code} · ${basel.dates[0]}–${basel.dates[basel.dates.length - 1]} · $${Math.round(basel.totalRevenue).toLocaleString()} · ${basel.referrers.length} referrers`);
  log('Done.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
