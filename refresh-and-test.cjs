const axios = require('axios');
const fs = require('fs');

const SESSION_FILE = 'C:\\Cursor\\toast-mcp-server\\toast-session.json';
const TOKEN_FILE = 'C:\\Cursor\\toast-mcp-server\\toast-web-token.json';

const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
const cookieStr = session.cookies
  .filter(c => c.domain.includes('toasttab.com'))
  .map(c => `${c.name}=${c.value}`)
  .join('; ');

async function testGenerate(token, locationGuid, reportGuid, label, extraHeaders = {}) {
  const url = 'https://www.toasttab.com/api/service/report-generator/v1/customReports/generate';
  const body = {
    renderer: 'JSON',
    locations: [[{ locationGuid, locationType: 'RESTAURANT' }]],
    dateRanges: { customDateRanges: [{ startDateYYYYMMDD: '20260706', endDateYYYYMMDD: '20260712' }] },
    panels: [
      {
        outputName: 'e2a4e62f-a9a2-4389-b8c5-e15f935f2c3a',
        type: 'TABLE',
        source: { type: 'metrics', metrics: ['AVERAGE_ITEM_FULFILLMENT_TIME'], groupBy: ['MENU_ITEM_NAME'], filters: [], comparisons: [] },
      },
    ],
    parameters: { customReportGuid: reportGuid },
  };
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json',
    Referer: `https://www.toasttab.com/restaurants/admin/reports/custom-reports/${reportGuid}`,
    Cookie: cookieStr,
    ...extraHeaders,
  };
  const res = await axios.post(url, body, { headers, validateStatus: () => true });
  console.log(`[${label}] Status: ${res.status}`);
  const bodyStr = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  console.log(`[${label}] Response:`, bodyStr.slice(0, 300));
  return res;
}

async function main() {
  const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const token = tokenData.token;
  console.log('Token age (mins):', ((Date.now() - new Date(tokenData.capturedAt).getTime()) / 60000).toFixed(1));

  // Test all venues
  const venues = [
    { label: 'claudie', locationGuid: '380f8195-ef88-495e-b144-6e3202ccc569', reportGuid: '348049c9-17de-45f8-8417-326b31dabf6a' },
    { label: 'ava_winter_park', locationGuid: '0a365c66-d2b9-42ab-8f45-94ea26d50716', reportGuid: '12f2a503-a94e-4a9c-b349-50480ae3cb5b' },
    { label: 'mila', locationGuid: '38e76bee-b844-427c-b078-260aa025f556', reportGuid: 'bf072204-b9c6-4982-92af-abef3c87924a' },
  ];

  for (const v of venues) {
    const res = await testGenerate(token, v.locationGuid, v.reportGuid, v.label);
    if (res.status === 200) {
      fs.writeFileSync('test-generate-response.json', JSON.stringify(res.data, null, 2));
      console.log('SUCCESS! Saved to test-generate-response.json');
      const data = res.data;
      const panels = data.panels || [];
      panels.forEach(p => console.log('Panel:', p.outputName, 'rows:', p.data?.length || 0));
      break;
    }
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
