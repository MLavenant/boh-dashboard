import dotenv from "dotenv";
dotenv.config({ path: "C:\\Cursor\\toast-mcp-server\\.env", override: true });

import axios from "axios";

const TOAST_BASE = "https://ws-api.toasttab.com";
const GUID_CASA_NEOS = process.env.GUID_CASA_NEOS;

async function getToken() {
  const r = await axios.post(`${TOAST_BASE}/authentication/v1/authentication/login`, {
    clientId: process.env.TOAST_CLIENT_ID, clientSecret: process.env.TOAST_API_SECRET, userAccessType: "TOAST_MACHINE_CLIENT"
  });
  return r.data.token.accessToken;
}

const token = await getToken();
const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=20260704`, {
  headers: { Authorization: `Bearer ${token}`, "Toast-Restaurant-External-ID": GUID_CASA_NEOS }
});
const orders = Array.isArray(r.data) ? r.data : Object.values(r.data);

// Get table config
const tc = await axios.get(`${TOAST_BASE}/config/v2/tables`, {
  headers: { Authorization: `Bearer ${token}`, "Toast-Restaurant-External-ID": GUID_CASA_NEOS }
});
const tables = Array.isArray(tc.data) ? tc.data : (tc.data?.tables || tc.data?.results || []);
const nameToGuid = {};
for (const t of tables) {
  const name = t.name ?? t.tableName ?? t.externalId;
  if (name && t.guid) nameToGuid[String(name).trim()] = t.guid;
}

// BS tables for casa_neos
const bsTables = new Set(["34","51","52","31","41","32","33","35","36","42","43","46","48","49","53","54","55","56","45","44","47","24","25","26","27","28","19","20","21","22","23","C1","C2","C3","C4","C5","C6","C7","C8","C9","C10","C1A","C2A","C3A","C4A","C5A","C6A","C7A","C8A","C9A","C10A","D1","D2","D3","D4","D5","D6","D7"]);
const bsGuids = new Set(Object.entries(nameToGuid).filter(([n]) => bsTables.has(n)).map(([,g]) => g));

console.log(`Total tables loaded: ${Object.keys(nameToGuid).length}`);
console.log(`BS table GUIDs matched: ${bsGuids.size}`);

let total = 0, matched = 0;
for (const order of orders) {
  if (!bsGuids.has(order.table?.guid)) continue;
  const dt = new Date(new Date(order.openedDate).getTime() - 4*60*60*1000);
  const frac = (dt.getUTCHours()*60 + dt.getUTCMinutes()) / 1440;
  if (frac < 0.604167 || frac > 0.833333) continue;
  for (const check of (order.checks || [])) {
    if (check.voided) continue;
    const amt = (check.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);
    total += amt;
    matched++;
  }
}
console.log(`July 4 Casa Neos BS total: $${Math.round(total*100)/100} (${matched} checks)`);
console.log(`Expected: $80,046.25`);
