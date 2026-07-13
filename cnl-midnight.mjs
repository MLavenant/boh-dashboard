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

// Check when orders are for Jul 5 night - do they show up under Jul 5 or Jul 6 business date?
for (const bd of ["20260705", "20260706"]) {
  const allOrders = [];
  for (let page=1; page<=10; page++) {
    const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=${bd}&pageSize=100&page=${page}`, {
      headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }
    });
    const batch = Array.isArray(r.data)?r.data:Object.values(r.data);
    allOrders.push(...batch);
    if (batch.length < 100) break;
  }
  // Find orders opened after midnight local time
  const after = allOrders.filter(o => {
    if (!o.openedDate) return false;
    const local = new Date(new Date(o.openedDate).getTime()-4*60*60*1000);
    const frac = (local.getUTCHours()*60+local.getUTCMinutes())/1440;
    return frac <= 0.208333; // before 5 AM
  });
  console.log(`businessDate ${bd}: ${allOrders.length} total orders, ${after.length} opened before 5AM local`);
  if (after.length > 0) {
    const sample = after[0];
    const localTime = new Date(new Date(sample.openedDate).getTime()-4*60*60*1000);
    console.log(`  Sample: openedDate=${sample.openedDate} → local=${localTime.toISOString()}`);
  }
}
