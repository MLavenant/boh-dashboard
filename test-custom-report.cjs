const axios = require('axios');
const fs = require('fs');
const session = JSON.parse(fs.readFileSync('toast-session.json', 'utf8'));
const cookieStr = session.cookies
  .filter(c => c.domain.includes('toasttab.com'))
  .map(c => `${c.name}=${c.value}`)
  .join('; ');

async function test() {
  const base = 'https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a';
  const headers = { Cookie: cookieStr, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: '*/*', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.toasttab.com/restaurants/admin/reports/home' };

  const attempts = [
    { params: { reportDateRange: 'lastWeek', excel: true } },
    { params: { startDate: '20260706', endDate: '20260712', excel: true } },
    { params: { reportDateRange: 'custom', startDate: '20260706', endDate: '20260712', excel: true } },
  ];

  for (const { params } of attempts) {
    console.log('\n--- Trying params:', params);
    try {
      const resp = await axios.get(base, {
        params,
        headers,
        responseType: 'arraybuffer',
        maxRedirects: 0,
        validateStatus: () => true
      });
      console.log('Status:', resp.status);
      console.log('Headers:', JSON.stringify(resp.headers, null, 2).slice(0, 500));
      const body = Buffer.from(resp.data).toString('utf8');
      if (resp.data.length < 2000) {
        console.log('Body:', body);
      } else {
        fs.writeFileSync('test-custom-report.bin', resp.data);
        console.log('Binary size:', resp.data.length, '- saved to test-custom-report.bin');
      }
    } catch(e) {
      console.log('Axios error:', e.message);
    }
  }
}
test();
