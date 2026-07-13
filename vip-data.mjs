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

const tc = await axios.get(`${TOAST_BASE}/config/v2/tables`, {headers:{Authorization:`Bearer ${token}`,"Toast-Restaurant-External-ID":GUID}});
const tables = Array.isArray(tc.data)?tc.data:(tc.data?.tables||tc.data?.results||[]);
const nameToGuid={}, guidToName={};
for(const t of tables){const n=(t.name??t.tableName??t.externalId??"").trim();if(n&&t.guid){nameToGuid[n]=t.guid;guidToName[t.guid]=n;}}

const TIERS = {
  Diamond:  ["34","51","52"],
  Prestige: ["31","41"],
  Platinum: ["32","33","35","36","42","43","45","46","47","48","49","53","54","55","56"],
  Gold:     ["24","25","26","27","28"],
  Riverwalk:["19","20","21","22","23"],
  Cabana:   ["C1","C2","C3","C4","C5","C6","C7","C8","C9","C10","C1A","C2A","C3A","C4A","C5A","C6A","C7A","C8A","C9A","C10A"],
  Deck:     ["D1","D2","D3","D4","D5","D6","D7"],
};
const MIN_PER_TABLE = {Diamond:4000,Prestige:3500,Platinum:2000,Gold:1500,Riverwalk:1000,Cabana:500,Deck:500};

const ALL_BS = new Set(Object.values(TIERS).flat());
const bsGuids = new Set();
for(const [n,g] of Object.entries(nameToGuid)){if(ALL_BS.has(n)||ALL_BS.has(n.toUpperCase()))bsGuids.add(g);}

const dates = ["2026-07-04","2026-07-05"];
const byTable = {};

for(const date of dates){
  const allOrders=[];
  for(let p=1;p<=10;p++){
    const r=await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=${date.replace(/-/g,"")}&pageSize=100&page=${p}`,{headers:{Authorization:`Bearer ${token}`,"Toast-Restaurant-External-ID":GUID}});
    const batch=Array.isArray(r.data)?r.data:Object.values(r.data);
    allOrders.push(...batch);
    if(batch.length<100)break;
  }
  for(const o of allOrders){
    const tg=o.table?.guid??"";
    if(!bsGuids.has(tg))continue;
    const dt=new Date(new Date(o.openedDate).getTime()-4*60*60*1000);
    const frac=(dt.getUTCHours()*60+dt.getUTCMinutes())/1440;
    if(!(frac>=0.604167&&frac<=0.833333))continue;
    const tname=guidToName[tg]??tg;
    if(!byTable[tname])byTable[tname]={total:0,checks:0};
    for(const c of(o.checks||[])){
      if(c.voided)continue;
      const amt=(c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);
      if(!amt)continue;
      byTable[tname].total+=amt;byTable[tname].checks+=1;
    }
  }
}
for(const t of Object.keys(byTable))byTable[t].total=Math.round(byTable[t].total*100)/100;

// Build tier summary
const byTier={};
let grandTotal=0;
for(const [tier,tierTables] of Object.entries(TIERS)){
  const sold=tierTables.filter(t=>(byTable[t]?.total??0)>0);
  const totalSales=tierTables.reduce((s,t)=>s+(byTable[t]?.total??0),0);
  byTier[tier]={totalTables:tierTables.length,soldTables:sold.length,totalSales:Math.round(totalSales*100)/100,avgPerTable:sold.length>0?Math.round(totalSales/sold.length*100)/100:0,minPerTable:MIN_PER_TABLE[tier],tableDetail:tierTables.map(t=>({table:t,sales:byTable[t]?.total??0,checks:byTable[t]?.checks??0})).sort((a,b)=>b.sales-a.sales)};
  grandTotal+=totalSales;
}

console.log(JSON.stringify({byTier,grandTotal:Math.round(grandTotal*100)/100},null,2));
