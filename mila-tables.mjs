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

// Get all table names
const tc = await axios.get(`${TOAST_BASE}/config/v2/tables`, { headers: { Authorization:`Bearer ${token}`, "Toast-Restaurant-External-ID":GUID }});
const tables = Array.isArray(tc.data) ? tc.data : (tc.data?.tables||tc.data?.results||[]);
const allNames = tables.map(t => (t.name??t.tableName??t.externalId??'?').trim()).sort();
console.log("All tables in Toast MILA:", allNames.join(", "));

const bsTables = new Set(["402","304","303","302","301","308","410","401","403","404","305","306","307","408","408bis","407","405","409","406","1","2","3","4","5","6","7","8","9","10","11","12","1A","2A","3A","4A","5A","6A","7A","8A","9A","10A","11A","12A","S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12","S13","S14","S15","S16","S17","S18","S19","S20","S21","S22","S23","S24","S25","S26","S27","S28","S29","S30","73"]);

const inToast = allNames.filter(n => bsTables.has(n));
const notInToast = [...bsTables].filter(n => !allNames.includes(n));
console.log(`\nBS tables found in Toast: ${inToast.length}/${bsTables.size}`);
console.log("Not matched:", notInToast.join(", "));
