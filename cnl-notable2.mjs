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
const bsTables = new Set(["809","808","905","904","903","902","810","906","907","908","909","910","911","912","901","807","806","805","804","803","L1","L2","L3","L4","L5","L6","L7","L8","L9","L10","L11","L12","L1A","L2A","L3A","L4A","L5A","L6A","L7A","L8A","L9A","L10A","L11A","L12A","44"]);
const bsGuids = new Set();
for (const t of tables) {
  const n=(t.name??t.tableName??t.externalId??'').trim();
  if (bsTables.has(n)||bsTables.has(n.toUpperCase())) bsGuids.add(t.guid);
}

const allOrders = [];
for (let page=1; page<=10; page++) {
  const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=20260705&pageSize=100&page=${page}`, {
    headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }
  });
  const batch = Array.isArray(r.data)?r.data:Object.values(r.data);
  allOrders.push(...batch);
  if (batch.length < 100) break;
}

let noTableInWindow=0, noTableTotal=0;
for (const o of allOrders) {
  if (o.table?.guid) continue; // skip orders WITH a table
  const dt = new Date(new Date(o.openedDate).getTime()-4*60*60*1000);
  const frac = (dt.getUTCHours()*60+dt.getUTCMinutes())/1440;
  const inWindow = (frac>=0.958333 || frac<=0.208333);
  for (const c of (o.checks||[])) {
    if (c.voided) continue;
    const amt = (c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);
    noTableTotal+=amt;
    if (inWindow) noTableInWindow+=amt;
  }
}
console.log(`No-table orders: total=$${Math.round(noTableTotal)}, in 11PM-5AM window=$${Math.round(noTableInWindow)}`);
console.log(`\nBS tables in window: $6,140 + no-table in window: $${Math.round(noTableInWindow)} = $${6140+Math.round(noTableInWindow)}`);
console.log(`BS tables no filter: $28,325 + no-table total: $${Math.round(noTableTotal)} = $${28325+Math.round(noTableTotal)}`);
console.log(`Expected: $32,187.50`);
