import dotenv from "dotenv";
dotenv.config({ path: "C:\\Cursor\\toast-mcp-server\\.env", override: true });
import axios from "axios";
const BASE = "https://ws-api.toasttab.com";
async function getToken() {
  const r = await axios.post(`${BASE}/authentication/v1/authentication/login`,
    {clientId:process.env.TOAST_CLIENT_ID,clientSecret:process.env.TOAST_API_SECRET,userAccessType:"TOAST_MACHINE_CLIENT"});
  return r.data.token.accessToken;
}
const token = await getToken();

// CN Lounge tiers (table → tier name)
const CNL_TABLE_TIER = {
  "809":"Diamond","808":"Diamond","905":"Diamond","904":"Diamond","903":"Diamond","902":"Diamond",
  "810":"Platinum","906":"Platinum","907":"Platinum","908":"Platinum","909":"Platinum","910":"Platinum","911":"Platinum","912":"Platinum","901":"Platinum",
  "807":"Gold","806":"Gold","805":"Gold","804":"Gold","803":"Gold",
};
for(let i=1;i<=12;i++){ CNL_TABLE_TIER[`L${i}`]="Lounge"; CNL_TABLE_TIER[`L${i}A`]="Lounge"; }

// MILA tiers
const MILA_TABLE_TIER = {
  "305":"Diamond","306":"Diamond","307":"Diamond","408":"Diamond","408bis":"Diamond","407":"Diamond","405":"Diamond","409":"Diamond","406":"Diamond",
  "403":"Prestige","404":"Prestige",
  "402":"Gold","304":"Gold","303":"Gold","302":"Gold","301":"Gold","308":"Gold","410":"Gold","401":"Gold",
};
for(let i=1;i<=12;i++){ MILA_TABLE_TIER[`${i}`]="Booths"; MILA_TABLE_TIER[`${i}A`]="Booths"; }
for(let i=1;i<=30;i++) MILA_TABLE_TIER[`S${i}`]="Seating";
MILA_TABLE_TIER["73"]="Seating";

// TIER MIN PER TABLE
const CNL_TIER_MIN  = {Diamond:2000,Platinum:1500,Gold:1000,Lounge:500};
const MILA_TIER_MIN = {Diamond:2000,Prestige:3000,Gold:1000,Booths:500,Seating:200};

async function getTableNameMap(venueGuid){
  const r = await axios.get(`${BASE}/config/v2/tables`,{headers:{Authorization:`Bearer ${token}`,"Toast-Restaurant-External-ID":venueGuid}});
  const tc = Array.isArray(r.data)?r.data:(r.data?.tables||r.data?.results||[]);
  const guidToName={}, nameToGuid={};
  for(const t of tc){
    const n=(t.name??t.tableName??t.externalId??"").trim();
    if(n&&t.guid){guidToName[t.guid]=n; if(!nameToGuid[n])nameToGuid[n]=t.guid;}
  }
  return {guidToName,nameToGuid};
}

async function getTableDetail(venueGuid, tableTierMap, tierMinMap, dates, startFrac, endFrac, crossesMidnight, includeNoTable, sundayStartFrac){
  const {guidToName, nameToGuid} = await getTableNameMap(venueGuid);
  const allBsNames = new Set(Object.keys(tableTierMap));
  const bsGuids = new Set();
  for(const [n,g] of Object.entries(nameToGuid)){
    if(allBsNames.has(n)||allBsNames.has(n.toUpperCase())||allBsNames.has(n.toLowerCase()))bsGuids.add(g);
  }

  const result = {};
  for(const date of dates){
    const byTable={};
    const allOrders=[];
    for(let p=1;p<=10;p++){
      const r=await axios.get(`${BASE}/orders/v2/ordersBulk?businessDate=${date.replace(/-/g,"")}&pageSize=100&page=${p}`,
        {headers:{Authorization:`Bearer ${token}`,"Toast-Restaurant-External-ID":venueGuid}});
      const batch=Array.isArray(r.data)?r.data:Object.values(r.data);
      allOrders.push(...batch); if(batch.length<100)break;
    }
    for(const o of allOrders){
      const hasTable=!!(o.table?.guid), isBs=bsGuids.has(o.table?.guid??"");
      if(!isBs&&!(includeNoTable&&!hasTable))continue;
      const dt=new Date(new Date(o.openedDate).getTime()-4*3600000);
      const frac=(dt.getUTCHours()*60+dt.getUTCMinutes())/1440;
      const isSun=new Date(date+"T12:00:00Z").getUTCDay()===0;
      const sf=(isSun&&sundayStartFrac!=null)?sundayStartFrac:startFrac;
      const inW=crossesMidnight?(frac>=sf||frac<=endFrac):(frac>=sf&&frac<=endFrac);
      if(!inW)continue;
      const tname=guidToName[o.table?.guid??""]??(o.table?.guid?"unknown":"__notbl__");
      if(!byTable[tname])byTable[tname]={sales:0,checks:0};
      for(const c of(o.checks||[])){if(c.voided)continue;const amt=(c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);if(!amt)continue;byTable[tname].sales+=amt;byTable[tname].checks+=1;}
    }
    result[date]=Object.entries(byTable).map(([tname,v])=>{
      const tier=tableTierMap[tname]||tableTierMap[tname?.toUpperCase()]||"Other";
      const minPT=tierMinMap[tier]||0;
      return {table:tname,tier,sales:Math.round(v.sales*100)/100,checks:v.checks,minPerTable:minPT};
    }).sort((a,b)=>b.sales-a.sales);
  }
  return result;
}

const GUID_CNL=process.env.GUID_CASA_NEOS_LOUNGE, GUID_MILA=process.env.GUID_MM_MILA;

const [cnlDetail, milaDetail] = await Promise.all([
  getTableDetail(GUID_CNL, CNL_TABLE_TIER, CNL_TIER_MIN, ["2026-07-02","2026-07-03","2026-07-04","2026-07-05"], 0.958333, 0.208333, true, true, 0.75),
  getTableDetail(GUID_MILA, MILA_TABLE_TIER, MILA_TIER_MIN, ["2026-07-01","2026-07-02","2026-07-03","2026-07-04"], 0.979167, 0.208333, true, false, null),
]);

import { writeFileSync } from "fs";
writeFileSync("C:\\Cursor\\toast-mcp-server\\vip-detail.json", JSON.stringify({cnl:cnlDetail,mila:milaDetail},null,2));
console.log("Done. CNL dates:", Object.keys(cnlDetail));
for(const [d,rows] of Object.entries(cnlDetail)) console.log(`CNL ${d}: ${rows.length} tables`);
for(const [d,rows] of Object.entries(milaDetail)) console.log(`MILA ${d}: ${rows.length} tables`);
