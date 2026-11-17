'use strict';
const { VENUES, getApiKey, listBookings, isCountableStatus } = require('../fv-api-client.cjs');

const BASE = process.env.FV_API_BASE || 'https://api.fourvenues.com/integrations';
const DATE = '2026-12-06';

function referrerDisplayName(user) {
  const profile = (user && user.profile) || {};
  const first = String(profile.name || '').trim();
  const last = String(profile.last_name || '').trim();
  if (first && last && first.toLowerCase().indexOf(last.toLowerCase()) === -1) return (first + ' ' + last).trim();
  return first || last || '';
}

function tablesOf(b) {
  const parts = String((b && b.space_name) || '').split(',').map(s => s.trim()).filter(Boolean);
  return { parts, n: parts.length || 1 };
}

async function main() {
  const venue = VENUES.find(v => v.key === 'casa_neos_bc');
  const apiKey = getApiKey(venue);
  if (!apiKey) throw new Error('Missing Beach Club API key');
  const users = await fetch(BASE + '/users/', { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' } }).then(r => r.json());
  const names = new Map();
  for (const user of (users && users.data) || []) {
    const label = referrerDisplayName(user);
    if (user && user._id && label) names.set(user._id, label);
  }
  const { bookings } = await listBookings(venue, { date: DATE });
  const keep = (bookings || []).filter(b => isCountableStatus(b.status || b.state));
  const rows = keep.map(b => {
    const ref = b.referral_id ? (names.get(b.referral_id) || 'Unknown referrer') : 'No referrer';
    const t = tablesOf(b);
    return {
      ref,
      guest: b.name || '',
      spaces: t.parts.length ? t.parts.join(', ') : '(no space name)',
      tables: t.n,
      price: Number(b.price) || 0,
      event: b.event_name || ''
    };
  }).filter(r => /beatrice/i.test(r.ref));
  rows.sort((a, b) => b.price - a.price || a.guest.localeCompare(b.guest));
  const tables = rows.reduce((s, r) => s + r.tables, 0);
  const revenue = rows.reduce((s, r) => s + r.price, 0);
  console.log(JSON.stringify({ date: DATE, venue: venue.name, reservations: rows.length, tables, revenue, rows }, null, 2));
}

main().catch(err => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
