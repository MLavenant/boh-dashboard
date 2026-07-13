'use strict';
// Quick retry for ava_winter_park and mila item details
const fs   = require('fs');
const path = require('path');

const SESSION_FILE  = 'C:\\Cursor\\toast-mcp-server\\toast-session.json';
const DATA_DIR      = 'C:\\Cursor\\toast-mcp-server\\data';
const TOAST_ADMIN   = 'https://www.toasttab.com';
const ENDPOINT      = '/restaurants/admin/reports/menu/toplevelitemselections';

const KITCHEN_GROUP_IDS = {
  ava_winter_park:   '500000013674501001',
  mila:              '500000000001501691',
};

const VENUES = ['ava_winter_park', 'mila'];

function getSessionCookies() {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  return session.cookies
    .filter(c => c.domain && c.domain.includes('toasttab.com'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

function parseCSV(csvText) {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const fields = [];
    let cur = '', inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { fields.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    fields.push(cur.trim());
    const row = {};
    headers.forEach((h, i) => { if (fields[i] !== undefined) row[h] = fields[i].replace(/^"|"$/g, ''); });
    return row;
  });
}

async function fetchURL(url, options = {}) {
  const { default: axios } = await import('axios');
  return axios({ url, ...options, validateStatus: () => true });
}

async function fetchItemDetails(venueKey) {
  console.log(`  [item-details] Fetching for ${venueKey}...`);
  const cookies = getSessionCookies();
  const headers = {
    Cookie: cookies,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: '*/*',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: 'https://www.toasttab.com/restaurants/admin/reports/home',
  };
  const groupId = KITCHEN_GROUP_IDS[venueKey];
  let qs = `excel=true&reportDateRange=lastWeek&numberOfRestaurants=1`;
  if (groupId) qs += `&reportGroupIds=${groupId}`;

  const triggerRes = await fetchURL(`${TOAST_ADMIN}${ENDPOINT}?${qs}`, { method: 'GET', headers });
  console.log(`    trigger status: ${triggerRes.status}`);
  const s3Url = triggerRes.headers['location'];
  if (!s3Url) throw new Error(`[${venueKey}] No S3 URL (status ${triggerRes.status}): ${JSON.stringify(triggerRes.data).slice(0,200)}`);

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 4000));
    const s3Res = await fetchURL(s3Url, { method: 'GET' });
    const d = s3Res.data;
    if (d.downloadUrl) {
      console.log(`    downloadUrl ready after ${i+1} polls`);
      const csvRes = await fetchURL(d.downloadUrl, { method: 'GET', responseType: 'arraybuffer' });
      const csvText = Buffer.from(csvRes.data).toString('latin1');
      return parseCSV(csvText);
    }
    if (d.status === 'ERROR' || d.status === 'FAILED') throw new Error(`Report error: ${d.message}`);
    if (i % 5 === 0) console.log(`    polling (${i+1})...`);
  }
  throw new Error(`[${venueKey}] timed out`);
}

function transformRows(rows) {
  return rows
    .filter(r => r['Void?'] !== 'true' && r['Void?'] !== true)
    .map(r => ({
      orderId:    r['Order Id']  || '',
      checkId:    r['Check Id']  || '',
      sentDate:   r['Sent Date'] || '',
      menuItem:   r['Menu Item'] || '',
      menuGroup:  r['Menu Group'] || '',
      diningArea: r['Dining Area'] || '',
      table:      r['Table'] || '',
      server:     r['Server'] || '',
      qty:        parseFloat(r['Qty'])      || 1,
      netPrice:   parseFloat(r['Net Price']) || 0,
    }));
}

async function main() {
  const entries = fs.readdirSync(DATA_DIR).filter(d => /^\d{4}-W\d{2}$/.test(d)).sort();
  const weekLabel = entries[entries.length - 1];
  const weekDir = path.join(DATA_DIR, weekLabel);
  console.log(`\n=== Retry Item Details | Week: ${weekLabel} ===\n`);

  // Wait 10s before starting to let server recover
  console.log('Waiting 10s for server to recover...');
  await new Promise(r => setTimeout(r, 10000));

  for (const venue of VENUES) {
    try {
      const rows = await fetchItemDetails(venue);
      const items = transformRows(rows);
      const outPath = path.join(weekDir, `item-details-${venue}.json`);
      fs.writeFileSync(outPath, JSON.stringify({ weekLabel, venue, items }, null, 2));
      console.log(`  Saved ${items.length} items → ${path.basename(outPath)}\n`);
    } catch (err) {
      console.error(`  ERROR for ${venue}:`, err.message, '\n');
    }
  }
  console.log('=== Done ===');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
