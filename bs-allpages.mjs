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
const GUID = process.env.GUID_CASA_NEOS;

// Fetch all pages
const allOrders = [];
for (let page = 1; page <= 50; page++) {
  const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=20260704&pageSize=100&page=${page}`, {
    headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }
  });
  const batch = Array.isArray(r.data) ? r.data : Object.values(r.data);
  allOrders.push(...batch);
  process.stdout.write(`Page ${page}: ${batch.length} orders (total: ${allOrders.length})\n`);
  if (batch.length < 100) break;
}
console.log(`\nTotal orders: ${allOrders.length}`);

// Table map
const tc = await axios.get(`${TOAST_BASE}/config/v2/tables`, { headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }});
const tables = Array.isArray(tc.data) ? tc.data : (tc.data?.tables||tc.data?.results||[]);
const nameToGuid = {};
for (const t of tables) { const n=t.name??t.tableName??t.externalId; if(n&&t.guid) nameToGuid[String(n).trim()]=t.guid; }

const bsTables = new Set(["34","51","52","31","41","32","33","35","36","42","43","46","48","49","53","54","55","56","45","44","47","24","25","26","27","28","19","20","21","22","23","C1","C2","C3","C4","C5","C6","C7","C8","C9","C10","C1A","C2A","C3A","C4A","C5A","C6A","C7A","C8A","C9A","C10A","D1","D2","D3","D4","D5","D6","D7"]);
const bsGuids = new Set(Object.entries(nameToGuid).filter(([n])=>bsTables.has(n)).map(([,g])=>g));

let total=0, checks=0, orders=0;
for (const o of allOrders) {
  if (!bsGuids.has(o.table?.guid)) continue;
  const dt = new Date(new Date(o.openedDate).getTime()-4*60*60*1000);
  const frac = (dt.getUTCHours()*60+dt.getUTCMinutes())/1440;
  if (frac < 0.604167 || frac > 0.833333) continue;
  orders++;
  for (const c of (o.checks||[])) {
    if (c.voided) continue;
    const amt = (c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);
    total += amt; checks++;
  }
}
console.log(`BS July 4 (all pages, selection sum): $${Math.round(total*100)/100} | ${orders} orders | ${checks} checks`);
console.log(`Expected: $80,046.25`);
