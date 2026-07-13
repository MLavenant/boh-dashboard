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
const GUID = process.env.GUID_MM_MILA;

// Get all tables with GUIDs
const tc = await axios.get(`${TOAST_BASE}/config/v2/tables`, { headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }});
const tables = Array.isArray(tc.data) ? tc.data : (tc.data?.tables||tc.data?.results||[]);

const bsTables = new Set(["402","304","303","302","301","308","410","401","403","404","305","306","307","408","408bis","407","405","409","406","1","2","3","4","5","6","7","8","9","10","11","12","1A","2A","3A","4A","5A","6A","7A","8A","9A","10A","11A","12A","S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12","S13","S14","S15","S16","S17","S18","S19","S20","S21","S22","S23","S24","S25","S26","S27","S28","S29","S30","73"]);

// With case-insensitive + all GUIDs for duplicates
const bsGuids = new Set();
for (const t of tables) {
  const name = (t.name??t.tableName??t.externalId??'').trim();
  if (bsTables.has(name) || bsTables.has(name.toUpperCase()) || bsTables.has(name.toLowerCase())) {
    bsGuids.add(t.guid);
  }
}
console.log(`BS GUIDs (case-insensitive + all duplicates): ${bsGuids.size}`);

// Fetch Jul 4 orders - all pages
const allOrders = [];
for (let page=1; page<=20; page++) {
  const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=20260704&pageSize=100&page=${page}`, {
    headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }
  });
  const batch = Array.isArray(r.data)?r.data:Object.values(r.data);
  allOrders.push(...batch);
  if (batch.length < 100) break;
}
console.log(`Total MILA orders Jul 4: ${allOrders.length}`);

// Time filter: 11:30 PM - 5:00 AM crosses midnight
let total=0, checked=0;
for (const o of allOrders) {
  if (!bsGuids.has(o.table?.guid)) continue;
  const dt = new Date(new Date(o.openedDate).getTime()-4*60*60*1000);
  const frac = (dt.getUTCHours()*60+dt.getUTCMinutes())/1440;
  if (!(frac>=0.979167 || frac<=0.208333)) continue;
  for (const c of (o.checks||[])) {
    if (c.voided) continue;
    const amt = (c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);
    total+=amt; checked++;
  }
}
console.log(`MILA Jul 4 BS (fixed): $${Math.round(total*100)/100} | ${checked} checks`);
console.log(`Expected: $34,180.40`);
