/**
 * Local smoke test for Azure Graph mailbox access.
 * Set env vars, then: node test-graph-mail.cjs
 */
'use strict';

const { getAppToken, listSalesReportMessages, pickReportForVenue } = require('./ms-graph-mail.cjs');
const { VENUES } = require('./fv-sales-export-lib.cjs');

(async () => {
  console.log('Getting app token…');
  const token = await getAppToken();
  console.log('Token OK');

  console.log('Listing Sales Report emails (14 days)…');
  const messages = await listSalesReportMessages({ token, top: 40, maxAgeDays: 14 });
  console.log(`Found ${messages.length} Sales Report message(s)`);
  messages.slice(0, 10).forEach(m => {
    console.log(`  - ${m.receivedDateTime}  from=${m.from || '?'}`);
  });

  for (const v of VENUES) {
    const hit = pickReportForVenue(messages, v.id);
    console.log(hit
      ? `  ✓ ${v.name}: match (received ${hit.message.receivedDateTime})`
      : `  ✗ ${v.name}: no matching link for venue id`);
  }
})().catch(e => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
