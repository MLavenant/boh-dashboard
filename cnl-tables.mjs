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
const allNames = tables.map(t=>(t.name??t.tableName??t.externalId??'').trim()).sort();
console.log("All CN Lounge tables:", allNames.join(", "));

const bsTables = new Set(["809","808","905","904","903","902","810","906","907","908","909","910","911","912","901","807","806","805","804","803","L1","L2","L3","L4","L5","L6","L7","L8","L9","L10","L11","L12","L1A","L2A","L3A","L4A","L5A","L6A","L7A","L8A","L9A","L10A","L11A","L12A","44"]);
const notMatched = [...bsTables].filter(n => !allNames.includes(n));
const inToast = allNames.filter(n => bsTables.has(n) || bsTables.has(n.toUpperCase()));
console.log(`\nBS tables in Toast: ${inToast.length}/${bsTables.size}`);
console.log("Not matched in Toast:", notMatched.join(", "));
console.log("Extra tables in Toast not in our config:", allNames.filter(n => !bsTables.has(n) && !bsTables.has(n.toUpperCase())).join(", "));
