/**
 * Fetch Toast Partner API labor time entries for a venue + ISO week.
 *
 * Usage:
 *   node fetch-labor-week.cjs casa_neos 2026-W30
 *   node fetch-labor-week.cjs --all 2026-W30
 *
 * Env: TOAST_CLIENT_ID, TOAST_API_SECRET
 * GUIDs are hardcoded to match kitchen FULFILLMENT_VENUE_GUIDS (env overrides still work).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const { STAFFING_VENUES, resolveVenueSlug } = require('./boh-staffing-shared.cjs');

const ROOT = process.env.BOH_ROOT || __dirname;
const TOAST_BASE = 'https://ws-api.toasttab.com';

/** Authoritative kitchen location GUIDs (same as weekly-save.js FULFILLMENT_VENUE_GUIDS). */
const VENUE_GUIDS = {
  casa_neos: process.env.GUID_CASA_NEOS || 'c3f36849-5105-44ab-9168-62be1f89a59e',
  casa_neos_lounge: process.env.GUID_CASA_NEOS_LOUNGE || 'f1f95f8b-80b9-42de-a8ba-47a5fb8aac70',
  claudie: process.env.GUID_CLAUDIE || '380f8195-ef88-495e-b144-6e3202ccc569',
  mila: process.env.GUID_MILA || '38e76bee-b844-427c-b078-260aa025f556',
  // Hardcode correct AVA GUIDs — .env historically swapped GUID_AVA_CG / GUID_AVA_CG2
  ava_coconut_grove: '1c653447-0a27-4f29-8e7c-d9141a8dc66c',
  ava_winter_park: '0a365c66-d2b9-42ab-8f45-94ea26d50716',
};

function isoWeekDates(weekLabel) {
  const m = String(weekLabel).match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`Bad week label: ${weekLabel}`);
  const year = +m[1];
  const week = +m[2];
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function dayName(dateStr) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    new Date(dateStr + 'T12:00:00').getDay()
  ];
}

async function getToken() {
  const clientId = process.env.TOAST_CLIENT_ID;
  const clientSecret = process.env.TOAST_API_SECRET;
  if (!clientId || !clientSecret) throw new Error('Missing TOAST_CLIENT_ID / TOAST_API_SECRET');
  const res = await axios.post(`${TOAST_BASE}/authentication/v1/authentication/login`, {
    clientId,
    clientSecret,
    userAccessType: 'TOAST_MACHINE_CLIENT',
  });
  return res.data.token.accessToken;
}

async function toastGet(token, venueGuid, apiPath) {
  const res = await axios.get(`${TOAST_BASE}${apiPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Toast-Restaurant-External-ID': venueGuid,
    },
    validateStatus: () => true,
  });
  if (res.status >= 400) {
    throw new Error(`${apiPath} → ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
  }
  return res.data;
}

async function fetchVenue(venueRaw, weekLabel, token) {
  const venue = resolveVenueSlug(venueRaw) || venueRaw;
  const venueGuid = VENUE_GUIDS[venue];
  if (!venueGuid) throw new Error(`No GUID for venue ${venueRaw}`);

  const dates = isoWeekDates(weekLabel);
  console.log(`Fetching labor for ${venue} ${weekLabel} (${dates[0]} → ${dates[6]})`);

  const [employees, jobs] = await Promise.all([
    toastGet(token, venueGuid, '/labor/v1/employees'),
    toastGet(token, venueGuid, '/labor/v1/jobs'),
  ]);

  const empByGuid = new Map();
  for (const e of employees || []) {
    const first = (e.firstName || '').trim();
    const last = (e.lastName || '').trim();
    empByGuid.set(e.guid, {
      firstName: first,
      lastName: last,
      displayName: [first, last].filter(Boolean).join(' '),
      payrollName: last && first ? `${last}, ${first}` : (last || first),
      deleted: !!e.deleted,
    });
  }

  const jobByGuid = new Map();
  for (const j of jobs || []) {
    jobByGuid.set(j.guid, j.title || j.name || j.code || j.guid);
  }

  const entries = [];
  for (const date of dates) {
    const start = `${date}T00:00:00.000-0400`;
    const end = `${date}T23:59:59.000-0400`;
    const data = await toastGet(
      token,
      venueGuid,
      `/labor/v1/timeEntries?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`
    );
    const list = Array.isArray(data) ? data : [];
    let kept = 0;
    for (const te of list) {
      if (te.deleted) continue;
      const hours = (te.regularHours || 0) + (te.overtimeHours || 0);
      if (hours < 0.25) continue;
      const empGuid = te.employeeReference?.guid;
      const emp = empByGuid.get(empGuid) || {};
      const jobGuid = te.jobReference?.guid;
      entries.push({
        date,
        day: dayName(date),
        businessDate: te.businessDate || date.replace(/-/g, ''),
        employeeGuid: empGuid || null,
        employeeName: emp.displayName || '',
        payrollName: emp.payrollName || '',
        jobGuid: jobGuid || null,
        jobName: jobByGuid.get(jobGuid) || '',
        inDate: te.inDate || null,
        outDate: te.outDate || null,
        hours: +hours.toFixed(3),
      });
      kept++;
    }
    console.log(`  ${date} (${dayName(date)}): ${list.length} raw → ${kept} kept`);
  }

  const outDir = path.join(ROOT, 'data', weekLabel);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `labor-${venue}.json`);
  const payload = {
    venue,
    weekLabel,
    fetchedAt: new Date().toISOString(),
    venueGuid,
    entryCount: entries.length,
    entries,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outPath} (${entries.length} entries)`);
  return outPath;
}

async function main() {
  const arg1 = process.argv[2] || 'casa_neos';
  const weekLabel = process.argv[3] || '2026-W30';
  const token = await getToken();

  if (arg1 === '--all') {
    for (const v of STAFFING_VENUES) {
      await fetchVenue(v, weekLabel, token);
    }
    return;
  }
  await fetchVenue(arg1, weekLabel, token);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
