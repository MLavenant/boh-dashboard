const axios = require('axios');
const fs = require('fs');

const SESSION_FILE = 'C:\\Cursor\\toast-mcp-server\\toast-session.json';
const TOKEN_FILE = 'C:\\Cursor\\toast-mcp-server\\toast-web-token.json';

const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
const cookieStr = session.cookies
  .filter(c => c.domain.includes('toasttab.com'))
  .map(c => `${c.name}=${c.value}`)
  .join('; ');

async function main() {
  const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const token = tokenData.token;

  const baseHeaders = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Cookie: cookieStr,
    Referer: 'https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a',
  };

  // Test 1: GET metadata
  const meta = await axios.get('https://www.toasttab.com/api/service/report-generator/v1/customReports/metadata', {
    headers: { ...baseHeaders, Accept: 'application/json' },
    validateStatus: () => true,
  });
  console.log('GET metadata status:', meta.status, JSON.stringify(meta.data).slice(0, 200));

  // Test 2: GET specific report config
  const cfg = await axios.get('https://www.toasttab.com/api/service/report-generator/v1/customReports/348049c9-17de-45f8-8417-326b31dabf6a', {
    headers: { ...baseHeaders, Accept: 'application/json' },
    validateStatus: () => true,
  });
  console.log('GET config status:', cfg.status, JSON.stringify(cfg.data).slice(0, 200));

  // Test 3: Try generating with metadata's first guid
  if (meta.status === 200 && Array.isArray(meta.data)) {
    const firstReport = meta.data[0];
    console.log('First report:', firstReport?.reportGuid, firstReport?.reportName);
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
