'use strict';
/**
 * Fetch OpenTable covers for a week using an existing ot-session.json Bearer token.
 * Avoids Okta password auth (which can LOCK_OUT the account).
 *
 * Usage: node fetch-ot-covers-week.cjs [weekLabel]
 * Example: node fetch-ot-covers-week.cjs 2026-W34
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ROOT = __dirname;
const OT_SESSION_FILE = path.join(ROOT, 'ot-session.json');
const OT_RESTAURANTS = {
  claudie: 1384252,
  casa_neos: 1304860,
  ava_coconut_grove: 1443061,
  ava_winter_park: 1208074,
  mila: 1054648,
  mila_omakase: 1271149,
};

function isoWeekRange(weekLabel) {
  const m = String(weekLabel).match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error('weekLabel must be YYYY-Www');
  const year = +m[1];
  const week = +m[2];
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(monday), endDate: fmt(sunday) };
}

function mapCover(row) {
  const visit = row.visitDate || row.seatedDate || '';
  return {
    visitDate: String(visit).slice(0, 10),
    seatedTime: row.seatedDate || row.visitDate || null,
    finishedTime: row.finishedDate || null,
    partySize: row.partySize || 1,
    tableName: row.tableId != null ? String(row.tableId) : (row.tableName || ''),
  };
}

async function fetchVenue(session, rid, startDate, endDate) {
  const headers = {
    Authorization: `Bearer ${session.token}`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json',
    Referer: 'https://guestcenter.opentable.com/',
    Cookie: session.cookies || '',
  };
  const baseUrl =
    'https://guestcenter.opentable.com/gateway/long-proxies/restaurant-reporting/reportingBiDatasources/api/v5/reservations/';
  let all = [];
  let offset = 0;
  const limit = 500;
  while (true) {
    const r = await axios.get(baseUrl, {
      params: {
        rid,
        startDate,
        endDate,
        offset,
        limit,
        sort: '-visitDate',
        stateCategories: 'seated,finished',
        isVisitDate: true,
      },
      headers,
      validateStatus: () => true,
    });
    if (r.status === 401) throw new Error('OT token expired (401) — refresh ot-session via a successful GuestCenter login');
    if (r.status !== 200) throw new Error(`OT API ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
    const items = r.data?.data || r.data?.reservations || (Array.isArray(r.data) ? r.data : []);
    if (!items.length) break;
    all = all.concat(items);
    if (items.length < limit) break;
    offset += limit;
  }
  return all.map(mapCover).filter((c) => c.seatedTime && c.finishedTime);
}

async function main() {
  const weekLabel = process.argv[2] || '2026-W34';
  if (!fs.existsSync(OT_SESSION_FILE)) throw new Error('Missing ot-session.json');
  const session = JSON.parse(fs.readFileSync(OT_SESSION_FILE, 'utf8'));
  if (!session.token) throw new Error('ot-session.json has no token');

  const { startDate, endDate } = isoWeekRange(weekLabel);
  const outDir = path.join(ROOT, 'data', weekLabel);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`OT covers ${weekLabel} (${startDate} → ${endDate})`);

  const summary = {};
  for (const [slug, rid] of Object.entries(OT_RESTAURANTS)) {
    try {
      const covers = await fetchVenue(session, rid, startDate, endDate);
      const out = { weekLabel, startDate, endDate, venue: slug, covers };
      fs.writeFileSync(path.join(outDir, `covers-${slug}.json`), JSON.stringify(out, null, 2));
      const guests = covers.reduce((a, c) => a + (c.partySize || 1), 0);
      summary[slug] = { reservations: covers.length, guests };
      console.log(`  ${slug}: ${covers.length} covers, ${guests} guests`);
    } catch (e) {
      summary[slug] = { error: e.message };
      console.error(`  ${slug}: ERROR ${e.message}`);
    }
  }
  fs.writeFileSync(path.join(outDir, 'covers-summary.json'), JSON.stringify(summary, null, 2));
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
