const fs = require('fs');

async function run() {
  const { chromium } = await import('playwright');
  const SESSION_FILE = 'C:\\Cursor\\toast-mcp-server\\toast-session.json';

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();

  const captured = [];

  context.on('request', req => {
    const url = req.url();
    if (url.includes('report-generator') || url.includes('customReport')) {
      captured.push({ type: 'request', method: req.method(), url, headers: req.headers(), body: req.postData()?.slice(0, 200) });
    }
  });

  context.on('response', async resp => {
    const url = resp.url();
    if (url.includes('report-generator') || url.includes('customReport')) {
      const status = resp.status();
      let body = '';
      try {
        const ct = resp.headers()['content-type'] || '';
        if (ct.includes('json')) body = (await resp.text()).slice(0, 3000);
        else body = `[binary: ${ct}]`;
      } catch {}
      captured.push({ type: 'response', status, url, body });
      console.log(`RESPONSE ${status} ${url.slice(0, 80)} -> ${body.slice(0, 200)}`);
    }
  });

  console.log('Navigating to custom report page...');
  await page.goto(
    'https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a?startDate=20260706&endDate=20260712',
    { waitUntil: 'domcontentloaded', timeout: 60000 }
  ).catch(e => console.log('Nav error:', e.message));
  
  console.log('Waiting for data loads...');
  await page.waitForTimeout(20000);
  
  await context.storageState({ path: SESSION_FILE });
  await browser.close();

  fs.writeFileSync('C:\\Cursor\\toast-mcp-server\\intercepted-all.json', JSON.stringify(captured, null, 2));
  console.log('Done! Captured', captured.length, 'entries. See intercepted-all.json');
}
run().catch(e => { console.error(e); process.exit(1); });
