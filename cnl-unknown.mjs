import dotenv from "dotenv";
dotenv.config({ path: "C:\\Cursor\\toast-mcp-server\\.env", override: true });
import axios from "axios";
const TOAST_BASE = "https://ws-api.toasttab.com";
async function getToken() {
  const r = await axios.post(`${TOAST_BASE}/authentication/v1/authentication/login`, {
    clientId: process.env.TOAST_CLIENT_ID, clientSecret: process.env.TOAST_API_SECRET, userAccessType: "TOAST_MACHINE_CLIENT"
  });
  return r.data.token.accessToken;
}
const token = await getToken();
const GUID = process.env.GUID_CASA_NEOS_LOUNGE;
const tc = await axios.get(`${TOAST_BASE}/config/v2/tables`, { headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }});
const tables = Array.isArray(tc.data)?tc.data:(tc.data?.tables||tc.data?.results||[]);
const guidToName = {};
for (const t of tables) {
  const n=(t.name??t.tableName??t.externalId??'').trim();
  if (n&&t.guid) guidToName[t.guid]=n;
}
console.log(`Known table GUIDs: ${Object.keys(guidToName).length}`);

const allOrders = [];
for (let page=1; page<=10; page++) {
  const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=20260705&pageSize=100&page=${page}`, {
    headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }
  });
  const batch = Array.isArray(r.data)?r.data:Object.values(r.data);
  allOrders.push(...batch);
  if (batch.length < 100) break;
}

// Show orders with unknown table GUIDs and their amounts
let unknownTotal=0;
const unknownGuids = {};
for (const o of allOrders) {
  const tg = o.table?.guid;
  if (!tg || guidToName[tg]) continue;
  // Unknown GUID
  let amt = 0;
  for (const c of (o.checks||[])) {
    if (!c.voided) amt += (c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);
  }
  if (!unknownGuids[tg]) unknownGuids[tg]=0;
  unknownGuids[tg]+=amt;
  unknownTotal+=amt;
}
console.log(`Unknown table GUIDs: ${Object.keys(unknownGuids).length}`);
for (const [g,a] of Object.entries(unknownGuids).sort(([,a],[,b])=>b-a)) {
  console.log(`  ${g}: $${Math.round(a)}`);
}
console.log(`Total from unknown GUIDs: $${Math.round(unknownTotal)}`);

// Cross check: what table names are these GUIDs associated with in a different API call?
// Try to look up one unknown GUID
const unknownList = Object.keys(unknownGuids).slice(0,3);
for (const g of unknownList) {
  // Check if this GUID appears in any archived/inactive table config
  console.log(`\nUnknown GUID: ${g}`);
}
