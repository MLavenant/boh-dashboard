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

const tests = [["2026-07-02",28750.01,"Thu"],["2026-07-03",13130.01,"Fri"],["2026-07-04",28522,"Sat"],["2026-07-05",32187.50,"Sun"]];
for (const [date,expected,day] of tests) {
  const isSunday = new Date(date+'T12:00:00Z').getUTCDay()===0;
  const startFrac = isSunday ? 0.75 : 0.958333;
  const allOrders = [];
  for (let p=1;p<=10;p++) {
    const r = await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=${date.replace(/-/g,'')}&pageSize=100&page=${p}`, {headers:{Authorization:`Bearer ${token}`,"Toast-Restaurant-External-ID":GUID}});
    const batch=Array.isArray(r.data)?r.data:Object.values(r.data);
    allOrders.push(...batch);
    if(batch.length<100)break;
  }
  let total=0;
  for (const o of allOrders) {
    const hasTable=!!(o.table?.guid);
    const isBs=bsGuids.has(o.table?.guid??"");
    if(!isBs&&!(true&&!hasTable))continue;
    const dt=new Date(new Date(o.openedDate).getTime()-4*60*60*1000);
    const frac=(dt.getUTCHours()*60+dt.getUTCMinutes())/1440;
    if(!(frac>=startFrac||frac<=0.208333))continue;
    for(const c of(o.checks||[])){if(c.voided)continue;total+=(c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);}
  }
  total=Math.round(total*100)/100;
  console.log(`${day} ${date}: $${total} vs expected $${expected} → ${Math.round(total/expected*1000)/10}%`);
}
