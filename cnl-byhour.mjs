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
const nameToGuid = {};
for (const t of tables) { const n=(t.name??t.tableName??t.externalId??'').trim(); if(n&&t.guid) nameToGuid[n]=t.guid; }

const allOrders = [];
for (let page=1; page<=10; page++) {
  const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=20260705&pageSize=100&page=${page}`, {
    headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }
  });
  const batch = Array.isArray(r.data)?r.data:Object.values(r.data);
  allOrders.push(...batch);
  if (batch.length < 100) break;
}

// Show revenue by hour (no table filter) to understand distribution
const byHour = {};
let totalNoFilter = 0;
for (const o of allOrders) {
  const dt = new Date(new Date(o.openedDate).getTime()-4*60*60*1000);
  const hr = dt.getUTCHours();
  for (const c of (o.checks||[])) {
    if (c.voided) continue;
    const amt = (c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);
    if (!byHour[hr]) byHour[hr]=0;
    byHour[hr]+=amt;
    totalNoFilter+=amt;
  }
}
const hrs = Object.keys(byHour).map(Number).sort((a,b)=>a-b);
console.log("Revenue by local hour (all tables, business date Jul 5):");
for (const hr of hrs) console.log(`  ${String(hr).padStart(2,'0')}:xx → $${Math.round(byHour[hr])}`);
console.log(`Total no filter: $${Math.round(totalNoFilter)}`);
console.log(`Expected BS total: $32,187.50`);
