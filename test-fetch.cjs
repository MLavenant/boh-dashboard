const axios = require('axios');
const fs = require('fs');

const session = JSON.parse(fs.readFileSync('C:\\Cursor\\toast-mcp-server\\toast-session.json', 'utf8'));
const cookies = session.cookies
  .filter(c => c.domain && c.domain.includes('toasttab.com'))
  .map(c => `${c.name}=${c.value}`)
  .join('; ');

console.log('Cookie count:', session.cookies.filter(c => c.domain && c.domain.includes('toasttab.com')).length);

const KITCHEN_GROUP_IDS = {
  claudie: "500000037853698711",
  ava_coconut_grove: "500000056033936853",
};

async function test() {
  for (const [venue, groupId] of Object.entries(KITCHEN_GROUP_IDS)) {
    console.log(`\n--- Testing ${venue} ---`);
    const qs = `excel=true&reportDateRange=lastWeek&numberOfRestaurants=1&reportGroupIds=${groupId}`;
    try {
      const resp = await axios.get(
        `https://www.toasttab.com/restaurantkitchenreports/kitchendetailstable?${qs}`,
        {
          headers: {
            Cookie: cookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: '*/*',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: 'https://www.toasttab.com/restaurants/admin/reports/home',
          },
          validateStatus: () => true,
          maxRedirects: 0,
        }
      );
      console.log('Status:', resp.status);
      console.log('Location header:', resp.headers['location'] || '(none)');
      console.log('Content-Type:', resp.headers['content-type']);
      const bodyStr = typeof resp.data === 'string' ? resp.data : Buffer.from(resp.data).toString('utf8');
      console.log('Body (first 500):', bodyStr.slice(0, 500));

      const s3Url = resp.headers['location'];
      if (s3Url) {
        console.log('\nPolling S3 URL...');
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const s3Res = await axios.get(s3Url, { validateStatus: () => true });
          console.log(`  Poll ${i+1}: status=${s3Res.status}, data=`, JSON.stringify(s3Res.data).slice(0, 300));
          if (s3Res.data && s3Res.data.downloadUrl) {
            console.log('  Got downloadUrl! Fetching CSV...');
            const csvRes = await axios.get(s3Res.data.downloadUrl, { responseType: 'arraybuffer', validateStatus: () => true });
            const csvText = Buffer.from(csvRes.data).toString('latin1');
            console.log('  CSV first 300 chars:', csvText.slice(0, 300));
            break;
          }
          if (s3Res.data && (s3Res.data.status === 'ERROR' || s3Res.data.status === 'FAILED')) {
            console.log('  Report error:', s3Res.data.message);
            break;
          }
        }
      }
    } catch(e) {
      console.log('Error:', e.message);
      if (e.response) {
        console.log('Response status:', e.response.status);
        console.log('Response headers:', JSON.stringify(e.response.headers));
      }
    }
    break; // just test claudie for now
  }
}

test().catch(console.error);
