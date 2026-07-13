const axios = require('axios');
const fs = require('fs');

const session = JSON.parse(fs.readFileSync('C:\\Cursor\\toast-mcp-server\\toast-session.json', 'utf8'));
const cookies = session.cookies
  .filter(c => c.domain && c.domain.includes('toasttab.com'))
  .map(c => `${c.name}=${c.value}`)
  .join('; ');

const headers = {
  Cookie: cookies,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.toasttab.com/restaurants/admin/reports',
};

const TARGET_NAMES = [
  'Fulfillment time by item Mila',
  'Fulfillment time by item Winter Park',
  'Fulfillment time by item Casa Neos',
  'Fulfillment time by item Coconut Grove',
  'Fulfillment time by item CLAUDIE',
];

async function tryEndpoint(url) {
  try {
    console.log(`\nTrying: ${url}`);
    const res = await axios.get(url, { headers, timeout: 15000 });
    console.log(`  Status: ${res.status}, Content-Type: ${res.headers['content-type']}`);
    const data = res.data;
    if (typeof data === 'string') {
      console.log('  Response (first 500 chars):', data.slice(0, 500));
    } else {
      console.log('  Response keys:', Object.keys(data).slice(0, 10));
      console.log('  JSON (truncated):', JSON.stringify(data).slice(0, 800));
    }
    return data;
  } catch (e) {
    console.log(`  Error: ${e.response?.status || e.message}`);
    if (e.response) {
      const body = e.response.data;
      console.log('  Body:', typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300));
    }
    return null;
  }
}

async function main() {
  const endpoints = [
    'https://www.toasttab.com/restaurants/admin/reports/custom-reports-api/list',
    'https://www.toasttab.com/restaurants/admin/reports/custom-reports-api/reports',
    'https://www.toasttab.com/restaurants/admin/reports/api/custom-reports',
    'https://www.toasttab.com/restaurants/admin/reports/custom-reports',
  ];

  for (const url of endpoints) {
    const data = await tryEndpoint(url);
    if (data && typeof data === 'object') {
      // Try to find reports array
      const arr = Array.isArray(data) ? data : (data.reports || data.customReports || data.data || []);
      if (arr.length > 0) {
        console.log('\n=== Found reports! ===');
        for (const report of arr) {
          const name = report.name || report.reportName || report.title || JSON.stringify(report).slice(0, 80);
          const id = report.id || report.uuid || report.reportId || report.guid;
          console.log(`  Name: "${name}"  UUID: ${id}`);
          if (TARGET_NAMES.some(t => name.toLowerCase().includes(t.toLowerCase().replace('fulfillment time by item ', '')))) {
            console.log(`  ^^^ MATCH!`);
          }
        }
        break;
      }
    }
  }
}

main().catch(console.error);
