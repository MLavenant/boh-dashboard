const axios = require('axios');
const fs = require('fs');

const session = JSON.parse(fs.readFileSync('C:\\Cursor\\toast-mcp-server\\toast-session.json', 'utf8'));
const cookies = session.cookies
  .filter(c => c.domain && c.domain.includes('toasttab.com'))
  .map(c => `${c.name}=${c.value}`)
  .join('; ');

const toastHeaders = {
  Cookie: cookies,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: '*/*',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: 'https://www.toasttab.com/restaurants/admin/reports/home',
};

const GROUP_ID = "500000037853698711"; // claudie

async function test() {
  const qs = `excel=true&reportDateRange=lastWeek&numberOfRestaurants=1&reportGroupIds=${GROUP_ID}`;
  const url = `https://www.toasttab.com/restaurantkitchenreports/kitchendetailstable?${qs}`;
  
  console.log('Triggering export...');
  const triggerRes = await axios.get(url, {
    headers: toastHeaders,
    validateStatus: () => true,
    maxRedirects: 0,
  });
  
  console.log('Status:', triggerRes.status);
  console.log('All headers:', JSON.stringify(triggerRes.headers, null, 2));
  const locationUrl = triggerRes.headers['location'];
  console.log('Location:', locationUrl);
  
  if (!locationUrl) {
    console.log('No location header. Body:', 
      typeof triggerRes.data === 'string' ? triggerRes.data.slice(0, 500) : JSON.stringify(triggerRes.data).slice(0, 500));
    return;
  }

  // Try 1: Poll S3 URL with NO auth
  console.log('\n--- Attempt 1: Poll S3 URL directly (no auth) ---');
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const r = await axios.get(locationUrl, { validateStatus: () => true });
      console.log(`Poll ${i+1}: status=${r.status}, content-type=${r.headers['content-type']}`);
      const body = typeof r.data === 'string' ? r.data : (r.data instanceof Buffer ? r.data.toString('utf8') : JSON.stringify(r.data));
      console.log('Body:', body.slice(0, 400));
      if (r.status === 200) {
        fs.writeFileSync('C:\\Cursor\\toast-mcp-server\\s3-response.txt', body);
        console.log('Saved to s3-response.txt');
        break;
      }
    } catch(e) { console.log('Error:', e.message.slice(0,100)); }
  }

  // Try 2: Poll S3 URL WITH auth cookies
  console.log('\n--- Attempt 2: Poll S3 URL with Toast auth cookies ---');
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const r = await axios.get(locationUrl, { headers: toastHeaders, validateStatus: () => true });
      console.log(`Poll ${i+1}: status=${r.status}, content-type=${r.headers['content-type']}`);
      const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      console.log('Body:', body.slice(0, 400));
      if (r.status === 200) break;
    } catch(e) { console.log('Error:', e.message.slice(0,100)); }
  }

  // Try 3: Extract UUID from S3 URL and poll a Toast status endpoint
  const uuid = locationUrl.split('/').pop();
  console.log('\nExtracted UUID:', uuid);
  
  const statusEndpoints = [
    `https://www.toasttab.com/restaurantkitchenreports/exportstatus/${uuid}`,
    `https://www.toasttab.com/restaurants/admin/reports/exportStatus/${uuid}`,
    `https://www.toasttab.com/restaurantkitchenreports/download/${uuid}`,
    `https://www.toasttab.com/restaurants/admin/reports/download/${uuid}`,
  ];
  
  console.log('\n--- Attempt 3: Poll Toast status endpoints ---');
  for (const ep of statusEndpoints) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await axios.get(ep, { headers: toastHeaders, validateStatus: () => true });
      console.log(`${ep.slice(30)}: status=${r.status}`);
      if (r.status !== 404) {
        const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
        console.log('  body:', body.slice(0, 300));
      }
    } catch(e) { console.log('Error:', e.message.slice(0,80)); }
  }
}

test().catch(console.error);
