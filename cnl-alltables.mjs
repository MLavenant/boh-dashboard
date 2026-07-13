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

const bsTables = new Set(["809","808","905","904","903","902","810","906","907","908","909","910","911","912","901","807","806","805","804","803","L1","L2","L3","L4","L5","L6","L7","L8","L9","L10","L11","L12","L1A","L2A","L3A","L4A","L5A","L6A","L7A","L8A","L9A","L10A","L11A","L12A","44"]);

const allOrders = [];
for (let page=1; page<=10; page++) {
  const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=20260705&pageSize=100&page=${page}`, {
    headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }
  });
  const batch = Array.isArray(r.data)?r.data:Object.values(r.data);
  allOrders.push(...batch);
  if (batch.length < 100) break;
}

// Show ALL tables with revenue, flagging which are in BS config
const byTable = {};
for (const o of allOrders) {
  const tg = o.table?.guid;
  if (!tg) continue;
  const name = Object.entries(nameToGuid).find(([,g])=>g===tg)?.[0] ?? 'unknown';
  for (const c of (o.checks||[])) {
    if (c.voided) continue;
    const amt = (c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);
    if (!byTable[name]) byTable[name]={total:0,inBS:false};
    byTable[name].total+=amt;
    byTable[name].inBS = bsTables.has(name)||bsTables.has(name.toUpperCase());
  }
}
const sorted = Object.entries(byTable).sort(([,a],[,b])=>b.total-a.total).filter(([,a])=>a.total>0);
let bsTotal=0, nonBsTotal=0;
console.log("All tables with revenue on Jul 5 (BS? | name | $):");
for (const [n,v] of sorted) {
  console.log(`  ${v.inBS?'✓':'✗'} ${n}: $${Math.round(v.total)}`);
  if (v.inBS) bsTotal+=v.total; else nonBsTotal+=v.total;
}
console.log(`\nBS tables total: $${Math.round(bsTotal)}, Non-BS: $${Math.round(nonBsTotal)}, Grand: $${Math.round(bsTotal+nonBsTotal)}`);
console.log(`Expected: $32,187.50`);
