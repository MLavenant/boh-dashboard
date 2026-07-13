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

// Check raw response structure
const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=20260704`, {
  headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }
});
console.log("Status:", r.status);
console.log("Response type:", Array.isArray(r.data) ? "array" : typeof r.data);
if (Array.isArray(r.data)) {
  console.log("Count:", r.data.length);
} else {
  console.log("Keys:", Object.keys(r.data).slice(0,10));
}
console.log("Headers:", JSON.stringify(Object.fromEntries(
  Object.entries(r.headers).filter(([k]) => k.toLowerCase().includes("page") || k.toLowerCase().includes("total") || k.toLowerCase().includes("next"))
)));
