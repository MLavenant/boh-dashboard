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

// Get table map
const tc = await axios.get(`${TOAST_BASE}/config/v2/tables`, { headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }});
const tables = Array.isArray(tc.data) ? tc.data : (tc.data?.tables||tc.data?.results||[]);
const nameToGuid = {};
for (const t of tables) {
  const name = t.name??t.tableName??t.externalId;
  if (name && t.guid) nameToGuid[String(name).trim()] = t.guid;
}
console.log("Sample table names:", Object.keys(nameToGuid).slice(0,20).join(", "));

// Get orders
const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=20260704`, {
  headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }
});
const orders = Array.isArray(r.data) ? r.data : Object.values(r.data);
console.log(`Total orders: ${orders.length}`);

// Show all unique tables that had orders
const seenTables = {};
for (const o of orders) {
  const tg = o.table?.guid;
  if (!tg) continue;
  const name = Object.entries(nameToGuid).find(([,g])=>g===tg)?.[0] ?? "unknown";
  const amt = (o.checks||[]).flatMap(c=>c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);
  if (!seenTables[name]) seenTables[name] = 0;
  seenTables[name] += amt;
}
const sorted = Object.entries(seenTables).sort(([,a],[,b])=>b-a).slice(0,20);
console.log("Top tables by revenue:", JSON.stringify(sorted));

// Total without time filter
const bsTables = new Set(["34","51","52","31","41","32","33","35","36","42","43","46","48","49","53","54","55","56","45","44","47","24","25","26","27","28","19","20","21","22","23","C1","C2","C3","C4","C5","C6","C7","C8","C9","C10","C1A","C2A","C3A","C4A","C5A","C6A","C7A","C8A","C9A","C10A","D1","D2","D3","D4","D5","D6","D7"]);
const bsGuids = new Set(Object.entries(nameToGuid).filter(([n])=>bsTables.has(n)).map(([,g])=>g));
let totalNoTime = 0;
for (const o of orders) {
  if (!bsGuids.has(o.table?.guid)) continue;
  for (const c of (o.checks||[])) {
    if (c.voided) continue;
    totalNoTime += (c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);
  }
}
console.log(`Total WITHOUT time filter: $${Math.round(totalNoTime*100)/100}`);
