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

async function getTotal(bd, useCheckTime) {
  const allOrders = [];
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
    for (const c of (o.checks||[])) {
      if (c.voided) continue;
      // Use check openedDate OR order openedDate
      const dateStr = useCheckTime ? c.openedDate : o.openedDate;
      if (!dateStr) continue;
      const dt = new Date(new Date(dateStr).getTime()-4*60*60*1000);
      const frac = (dt.getUTCHours()*60+dt.getUTCMinutes())/1440;
      if (!(frac>=0.958333 || frac<=0.208333)) continue;
      total += (c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);
    }
  }
  return Math.round(total*100)/100;
}

// Test Jul 5 with both approaches
const orderTime = await getTotal("20260705", false);
const checkTime  = await getTotal("20260705", true);
console.log(`Jul 5 CN Lounge - order.openedDate filter: $${orderTime}`);
console.log(`Jul 5 CN Lounge - check.openedDate filter: $${checkTime}`);
console.log(`Expected: $32,187.50`);

// Also test Jul 4
const od4 = await getTotal("20260704", false);
const cd4 = await getTotal("20260704", true);
console.log(`Jul 4 - order time: $${od4} | check time: $${cd4} | expected: $28,522`);
