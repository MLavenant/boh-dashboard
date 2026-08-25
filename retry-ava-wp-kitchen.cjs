'use strict';
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SESSION_FILE = path.join(__dirname, 'toast-session.json');
const TOAST_ADMIN = 'https://www.toasttab.com';
const groupId = '500000013674501001'; // ava_winter_park
const weekLabel = '2026-W34';

function parseCSV(csvText) {
  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = [];
    let cur = '';
    let inQ = false;
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        if (inQ && line[j + 1] === '"') {
          cur += '"';
          j++;
        } else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        cols.push(cur);
        cur = '';
      } else cur += ch;
    }
    cols.push(cur);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] || '').replace(/^"|"$/g, '');
    });
    rows.push(obj);
  }
  return rows;
}

async function main() {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  const cookies = session.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const headers = {
    Cookie: cookies,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: '*/*',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: 'https://www.toasttab.com/restaurants/admin/reports/home',
  };
  const qs = `excel=true&reportDateRange=lastWeek&numberOfRestaurants=1&reportGroupIds=${groupId}`;
  const trigger = await axios.get(`${TOAST_ADMIN}/restaurantkitchenreports/kitchendetailstable?${qs}`, {
    headers,
    validateStatus: () => true,
  });
  const s3 = trigger.headers.location || trigger.headers.Location;
  console.log('trigger', trigger.status, !!s3, s3 ? 'ok' : '');
  if (!s3) throw new Error('No S3 URL status=' + trigger.status);
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s3Res = await axios.get(s3, { validateStatus: () => true });
    const d = s3Res.data;
    if (d.downloadUrl) {
      const csvRes = await axios.get(d.downloadUrl, { responseType: 'arraybuffer', validateStatus: () => true });
      const rows = parseCSV(Buffer.from(csvRes.data).toString('latin1'));
      console.log('rows', rows.length);
      const outDir = path.join(__dirname, 'data', weekLabel);
      fs.mkdirSync(outDir, { recursive: true });
      const out = {
        weekLabel,
        startDate: '2026-08-17',
        endDate: '2026-08-23',
        venue: 'ava_winter_park',
        tickets: rows,
      };
      fs.writeFileSync(path.join(outDir, 'kitchen-timing-ava_winter_park.json'), JSON.stringify(out));
      console.log('saved');
      return;
    }
    if (d.status === 'ERROR' || d.status === 'FAILED') throw new Error(JSON.stringify(d));
    if (i % 5 === 0) console.log('poll', i, d.status || 'pending');
  }
  throw new Error('timeout');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
