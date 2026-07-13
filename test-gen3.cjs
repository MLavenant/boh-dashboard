const axios = require('axios');
const fs = require('fs');

const TOKEN_FILE = 'C:\\Cursor\\toast-mcp-server\\toast-web-token.json';
const INTERCEPTED = 'C:\\Cursor\\toast-mcp-server\\intercepted-all.json';

const VENUES = {
  claudie:           { locationGuid: '380f8195-ef88-495e-b144-6e3202ccc569', reportGuid: '348049c9-17de-45f8-8417-326b31dabf6a' },
  mila:              { locationGuid: '38e76bee-b844-427c-b078-260aa025f556', reportGuid: 'bf072204-b9c6-4982-92af-abef3c87924a' },
  ava_winter_park:   { locationGuid: '0a365c66-d2b9-42ab-8f45-94ea26d50716', reportGuid: '12f2a503-a94e-4a9c-b349-50480ae3cb5b' },
  casa_neos:         { locationGuid: 'c3f36849-5105-44ab-9168-62be1f89a59e', reportGuid: '0bf4a402-432a-4335-83de-2b8cb33e26ba' },
  ava_coconut_grove: { locationGuid: '1c653447-0a27-4f29-8e7c-d9141a8dc66c', reportGuid: '24a8abfa-3b5a-48ec-8169-881f13a25f56' },
};

async function generate(token, venue, mgmtSetGuid, restaurantSetGuid) {
  const { locationGuid, reportGuid } = VENUES[venue];
  const url = 'https://www.toasttab.com/api/service/report-generator/v1/customReports/generate';
  const body = {
    renderer: 'JSON',
    locations: [[{ locationGuid, locationType: 'RESTAURANT' }]],
    dateRanges: { customDateRanges: [{ startDateYYYYMMDD: '20260706', endDateYYYYMMDD: '20260712' }] },
    panels: [{
      outputName: 'e2a4e62f-a9a2-4389-b8c5-e15f935f2c3a',
      type: 'TABLE',
      source: { type: 'metrics', metrics: ['AVERAGE_ITEM_FULFILLMENT_TIME'], groupBy: ['MENU_ITEM_NAME'], filters: [], comparisons: [] },
    }],
    parameters: { customReportGuid: reportGuid },
  };
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/json',
    Referer: `https://www.toasttab.com/restaurants/admin/reports/custom-reports/${reportGuid}`,
    'toast-restaurant-external-id': locationGuid,
    'toast-management-set-guid': mgmtSetGuid,
    'toast-restaurant-set-guid': restaurantSetGuid,
  };
  const res = await axios.post(url, body, { headers, validateStatus: () => true });
  console.log(`[${venue}] generate status: ${res.status}, reportRequestGuid: ${res.data?.reportRequestGuid}, apiStatus: ${res.data?.status}`);
  if (res.data?.reportRequestGuid) return { guid: res.data.reportRequestGuid, status: res.data.status };
  return null;
}

async function fetchResults(token, reportRequestGuid, restaurantExternalId, mgmtSetGuid, restaurantSetGuid) {
  const url = `https://www.toasttab.com/api/service/report-generator/v1/reportRequest/${reportRequestGuid}/results`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0',
    'toast-restaurant-external-id': restaurantExternalId,
    'toast-management-set-guid': mgmtSetGuid,
    'toast-restaurant-set-guid': restaurantSetGuid,
  };
  const res = await axios.get(url, { headers, validateStatus: () => true });
  return res;
}

async function main() {
  const intercepted = JSON.parse(fs.readFileSync(INTERCEPTED, 'utf8'));
  const genReq = intercepted.find(x => x.type === 'request' && x.url.includes('generate'));
  const liveToken = genReq.headers.authorization.replace('Bearer ', '');
  const mgmtSetGuid = genReq.headers['toast-management-set-guid'];
  const restaurantSetGuid = genReq.headers['toast-restaurant-set-guid'];
  console.log('mgmtSetGuid:', mgmtSetGuid, 'restaurantSetGuid:', restaurantSetGuid);

  for (const [venue, { locationGuid, reportGuid }] of Object.entries(VENUES)) {
    const result = await generate(liveToken, venue, mgmtSetGuid, restaurantSetGuid);
    if (result?.guid) {
      if (result.status === 'COMPLETED' || result.status === 'ERROR') {
        const r = await fetchResults(liveToken, result.guid, locationGuid, mgmtSetGuid, restaurantSetGuid);
        if (r.status === 200) {
          const items = r.data['e2a4e62f-a9a2-4389-b8c5-e15f935f2c3a'];
          console.log(`  [${venue}] ${items?.length} items. Sample:`, JSON.stringify(items?.slice(0,2)));
        } else {
          console.log(`  [${venue}] Results fetch failed:`, r.status, JSON.stringify(r.data).slice(0,200));
        }
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
