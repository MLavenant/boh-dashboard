const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = 'C:\\Cursor\\toast-mcp-server\\toast-web-token.json';
const SESSION_FILE = 'C:\\Cursor\\toast-mcp-server\\toast-session.json';
const INTERCEPTED = 'C:\\Cursor\\toast-mcp-server\\intercepted-all.json';
const TOAST_RESTAURANT_SET_GUID = '96e8e2b8-d95d-4432-b574-ceee10cf17d5';
const FULFILLMENT_TABLE_PANEL = 'e2a4e62f-a9a2-4389-b8c5-e15f935f2c3a';

const VENUES = {
  claudie:           { locationGuid: '380f8195-ef88-495e-b144-6e3202ccc569', reportGuid: '348049c9-17de-45f8-8417-326b31dabf6a' },
  mila:              { locationGuid: '38e76bee-b844-427c-b078-260aa025f556', reportGuid: 'bf072204-b9c6-4982-92af-abef3c87924a' },
  ava_winter_park:   { locationGuid: '0a365c66-d2b9-42ab-8f45-94ea26d50716', reportGuid: '12f2a503-a94e-4a9c-b349-50480ae3cb5b' },
  casa_neos:         { locationGuid: 'c3f36849-5105-44ab-9168-62be1f89a59e', reportGuid: '0bf4a402-432a-4335-83de-2b8cb33e26ba' },
  ava_coconut_grove: { locationGuid: '1c653447-0a27-4f29-8e7c-d9141a8dc66c', reportGuid: '24a8abfa-3b5a-48ec-8169-881f13a25f56' },
};

function getMsGuid() {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  const toastCookie = session.cookies.find(c => c.name === 'TOAST_SESSION');
  const decoded = decodeURIComponent(toastCookie.value);
  const m = decoded.match(/msGuid=([a-f0-9-]{36})/);
  return m[1];
}

function getHeaders(token, locationGuid, reportGuid) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json',
    Referer: `https://www.toasttab.com/restaurants/admin/reports/custom-reports/${reportGuid}`,
    'toast-restaurant-external-id': locationGuid,
    'toast-management-set-guid': getMsGuid(),
    'toast-restaurant-set-guid': TOAST_RESTAURANT_SET_GUID,
  };
}

async function fetchVenueData(token, venueKey, start, end) {
  const { locationGuid, reportGuid } = VENUES[venueKey];
  const headers = getHeaders(token, locationGuid, reportGuid);
  const body = {
    renderer: 'JSON',
    locations: [[{ locationGuid, locationType: 'RESTAURANT' }]],
    dateRanges: { customDateRanges: [{ startDateYYYYMMDD: start, endDateYYYYMMDD: end }] },
    panels: [{
      outputName: FULFILLMENT_TABLE_PANEL,
      type: 'TABLE',
      source: { type: 'metrics', metrics: ['AVERAGE_ITEM_FULFILLMENT_TIME'], groupBy: ['MENU_ITEM_NAME'], filters: [], comparisons: [] },
    }],
    parameters: { customReportGuid: reportGuid },
  };

  const genRes = await axios.post(
    'https://www.toasttab.com/api/service/report-generator/v1/customReports/generate',
    body, { headers, validateStatus: () => true }
  );
  if (genRes.status !== 200) throw new Error(`generate ${genRes.status}: ${JSON.stringify(genRes.data).slice(0,200)}`);

  const { reportRequestGuid, status: initStatus } = genRes.data;
  console.log(`  [${venueKey}] reportRequestGuid: ${reportRequestGuid}, status: ${initStatus}`);

  const resultsUrl = `https://www.toasttab.com/api/service/report-generator/v1/reportRequest/${reportRequestGuid}/results`;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, i === 0 && initStatus === 'COMPLETED' ? 0 : 3000));
    const r = await axios.get(resultsUrl, { headers, validateStatus: () => true });
    if (r.status === 200) {
      const panelData = r.data[FULFILLMENT_TABLE_PANEL];
      if (!panelData) throw new Error(`No panel data`);
      return panelData.filter(row => row.MENU_ITEM_NAME && row.AVERAGE_ITEM_FULFILLMENT_TIME != null)
        .map(row => ({ menuItem: row.MENU_ITEM_NAME, count: row.COUNT || 0, avgSeconds: Math.round(row.AVERAGE_ITEM_FULFILLMENT_TIME) }));
    }
    if (r.status === 202 || r.status === 404) { console.log(`  [${venueKey}] still processing...`); continue; }
    throw new Error(`results ${r.status}: ${JSON.stringify(r.data).slice(0,200)}`);
  }
  throw new Error('timed out');
}

async function main() {
  // Use the live token from intercepted data
  const intercepted = JSON.parse(fs.readFileSync(INTERCEPTED, 'utf8'));
  const genReq = intercepted.find(x => x.type === 'request' && x.url.includes('generate'));
  const token = genReq.headers.authorization.replace('Bearer ', '');
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, capturedAt: new Date().toISOString() }, null, 2));

  const weekLabel = '2026-W28';
  const weekDir = `C:\\Cursor\\toast-mcp-server\\data\\${weekLabel}`;
  if (!fs.existsSync(weekDir)) fs.mkdirSync(weekDir, { recursive: true });

  const startDate = '20260706';
  const endDate = '20260712';

  for (const venueKey of Object.keys(VENUES)) {
    try {
      console.log(`\nFetching ${venueKey}...`);
      const items = await fetchVenueData(token, venueKey, startDate, endDate);
      console.log(`  [${venueKey}] ${items.length} items`);
      const outPath = path.join(weekDir, `item-fulfillment-${venueKey}.json`);
      fs.writeFileSync(outPath, JSON.stringify({
        weekLabel, startDate: '2026-07-06', endDate: '2026-07-12', venue: venueKey, items
      }, null, 2));
      console.log(`  Saved to ${outPath}`);
    } catch(e) {
      console.error(`  ERROR for ${venueKey}:`, e.message);
    }
  }
  console.log('\nDone!');
}
main().catch(e => { console.error(e); process.exit(1); });
