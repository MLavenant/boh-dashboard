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

// Build name→guid map
const tc = await axios.get(`${TOAST_BASE}/config/v2/tables`, { headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }});
const tables = Array.isArray(tc.data)?tc.data:(tc.data?.tables||tc.data?.results||[]);
const bsTables = new Set(["809","808","905","904","903","902","810","906","907","908","909","910","911","912","901","807","806","805","804","803","L1","L2","L3","L4","L5","L6","L7","L8","L9","L10","L11","L12","L1A","L2A","L3A","L4A","L5A","L6A","L7A","L8A","L9A","L10A","L11A","L12A","44"]);
const bsGuids = new Set();
for (const t of tables) {
  const n=(t.name??t.tableName??t.externalId??'').trim();
  if (bsTables.has(n)||bsTables.has(n.toUpperCase())||bsTables.has(n.toLowerCase())) bsGuids.add(t.guid);
}
console.log(`BS GUIDs: ${bsGuids.size}`);

async function calcForDate(date, startHr, endHr) {
  const allOrders = [];
  const bd = date.replace(/-/g,'');
  for (let page=1; page<=10; page++) {
    const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=${bd}&pageSize=100&page=${page}`, {
      headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }
    });
    const batch = Array.isArray(r.data)?r.data:Object.values(r.data);
    allOrders.push(...batch);
    if (batch.length < 100) break;
  }
  let total=0;
  for (const o of allOrders) {
    if (!bsGuids.has(o.table?.guid)) continue;
    const dt = new Date(new Date(o.openedDate).getTime()-4*60*60*1000);
    const hr = dt.getUTCHours() + dt.getUTCMinutes()/60;
    // Window crosses midnight: hr >= startHr OR hr <= endHr
    const inWindow = (startHr > endHr) ? (hr >= startHr || hr <= endHr) : (hr >= startHr && hr <= endHr);
    if (!inWindow) continue;
    for (const c of (o.checks||[])) {
      if (c.voided) continue;
      total += (c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);
    }
  }
  return Math.round(total*100)/100;
}

// Test multiple time windows for Jul 5
const expected = 32187.50;
for (const [sh, eh] of [[23,5],[22,5],[21,5],[20,5],[19,5],[18,5],[0,24]]) {
  const val = await calcForDate("2026-07-05", sh, eh);
  console.log(`  Window ${sh}:00-${eh}:00: $${val} (expected $${expected})`);
}
