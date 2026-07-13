import dotenv from "dotenv";
dotenv.config({ path: "C:\\Cursor\\toast-mcp-server\\.env", override: true });
import axios from "axios";
const TOAST_BASE = "https://ws-api.toasttab.com";
async function getToken() {
  const r = await axios.post(`${TOAST_BASE}/authentication/v1/authentication/login`,
    {clientId:process.env.TOAST_CLIENT_ID,clientSecret:process.env.TOAST_API_SECRET,userAccessType:"TOAST_MACHINE_CLIENT"});
  return r.data.token.accessToken;
}
const token = await getToken();

// CN Lounge tiers
const CNL_TIERS = {
  Diamond:  {tables:new Set(["809","808","905","904","903","902"]),               min:2500, color:"#b9f2ff", text:"#0a4a6e"},
  Platinum: {tables:new Set(["810","906","907","908","909","910","911","912","901"]),min:2000, color:"#e8e8e8", text:"#2d2d2d"},
  Gold:     {tables:new Set(["807","806","805","804","803"]),                      min:1500, color:"#fff3cd", text:"#7d5a00"},
  Lounge:   {tables:new Set(["L1","L2","L3","L4","L5","L6","L7","L8","L9","L10","L11","L12","L1A","L2A","L3A","L4A","L5A","L6A","L7A","L8A","L9A","L10A","L11A","L12A"]), min:1000, color:"#d4edda", text:"#155724"},
};

// MILA tiers
const MILA_TIERS = {
  Diamond:  {tables:new Set(["305","306","307","408","408bis","407","405","409","406"]), min:3500, color:"#b9f2ff", text:"#0a4a6e"},
  Prestige: {tables:new Set(["403","404"]),                                             min:3000, color:"#e8d5ff", text:"#4a0080"},
  Gold:     {tables:new Set(["402","304","303","302","301","308","410","401"]),          min:2000, color:"#fff3cd", text:"#7d5a00"},
  Booths:   {tables:new Set(["1","2","3","4","5","6","7","8","9","10","11","12","1A","2A","3A","4A","5A","6A","7A","8A","9A","10A","11A","12A"]), min:1000, color:"#ffeaa7", text:"#6c4f00"},
  Seating:  {tables:new Set(["S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12","S13","S14","S15","S16","S17","S18","S19","S20","S21","S22","S23","S24","S25","S26","S27","S28","S29","S30","73"]), min:500, color:"#dfe6e9", text:"#2d3436"},
};

async function calcVenue(venueGuid, tiers, dates, startFrac, endFrac, crossesMidnight, includeNoTable, sundayStartFrac) {
  const tc = await axios.get(`${TOAST_BASE}/config/v2/tables`,{headers:{Authorization:`Bearer ${token}`,"Toast-Restaurant-External-ID":venueGuid}});
  const tablesCfg = Array.isArray(tc.data)?tc.data:(tc.data?.tables||tc.data?.results||[]);
  const nameToGuid={}, guidToName={};
  for(const t of tablesCfg){const n=(t.name??t.tableName??t.externalId??"").trim();if(n&&t.guid){nameToGuid[n]=t.guid;guidToName[t.guid]=n;}}

  const allBsTables = new Set(Object.values(tiers).flatMap(t=>[...t.tables]));
  const bsGuids = new Set();
  for(const [n,g] of Object.entries(nameToGuid)){
    if(allBsTables.has(n)||allBsTables.has(n.toUpperCase())||allBsTables.has(n.toLowerCase()))bsGuids.add(g);
  }

  const byDateTable = {};
  for(const date of dates){
    byDateTable[date] = {};
    const allOrders=[];
    for(let p=1;p<=10;p++){
      const r=await axios.get(`${TOAST_BASE}/orders/v2/ordersBulk?businessDate=${date.replace(/-/g,"")}&pageSize=100&page=${p}`,
        {headers:{Authorization:`Bearer ${token}`,"Toast-Restaurant-External-ID":venueGuid}});
      const batch=Array.isArray(r.data)?r.data:Object.values(r.data);
      allOrders.push(...batch); if(batch.length<100)break;
    }
    for(const o of allOrders){
      const hasTable=!!(o.table?.guid), isBs=bsGuids.has(o.table?.guid??"");
      if(!isBs&&!(includeNoTable&&!hasTable))continue;
      const dt=new Date(new Date(o.openedDate).getTime()-4*60*60*1000);
      const frac=(dt.getUTCHours()*60+dt.getUTCMinutes())/1440;
      const isSun=new Date(date+"T12:00:00Z").getUTCDay()===0;
      const sf = (isSun&&sundayStartFrac!=null)?sundayStartFrac:startFrac;
      const inW=crossesMidnight?(frac>=sf||frac<=endFrac):(frac>=sf&&frac<=endFrac);
      if(!inW)continue;
      const tname=guidToName[o.table?.guid??""]??(o.table?.guid?"unknown":"__notbl__");
      if(!byDateTable[date][tname])byDateTable[date][tname]={total:0,checks:0};
      for(const c of(o.checks||[])){if(c.voided)continue;const amt=(c.selections||[]).filter(s=>!s.voided).reduce((s,sel)=>s+(sel.price||0),0);if(!amt)continue;byDateTable[date][tname].total+=amt;byDateTable[date][tname].checks+=1;}
    }
    for(const t of Object.keys(byDateTable[date]))byDateTable[date][t].total=Math.round(byDateTable[date][t].total*100)/100;
  }

  const result={};
  for(const date of dates){
    result[date]={};
    for(const[tier,cfg]of Object.entries(tiers)){
      const tierTables=[...cfg.tables];
      const sold=tierTables.filter(t=>(byDateTable[date][t]?.total??0)>0);
      const totalSales=tierTables.reduce((s,t)=>s+(byDateTable[date][t]?.total??0),0);
      result[date][tier]={soldTables:sold.length,totalTables:tierTables.length,totalSales:Math.round(totalSales*100)/100,avgPerTable:sold.length>0?Math.round(totalSales/sold.length*100)/100:0,minPerTable:cfg.min,color:cfg.color,textColor:cfg.text};
    }
  }
  return result;
}

const GUID_CNL=process.env.GUID_CASA_NEOS_LOUNGE, GUID_MILA=process.env.GUID_MM_MILA;

const [cnlData, milaData] = await Promise.all([
  calcVenue(GUID_CNL, CNL_TIERS, ["2026-07-02","2026-07-03","2026-07-04","2026-07-05"], 0.958333, 0.208333, true, true, 0.75),
  calcVenue(GUID_MILA, MILA_TIERS, ["2026-07-01","2026-07-02","2026-07-03","2026-07-04"], 0.979167, 0.208333, true, false, null),
]);

console.log("=== CN LOUNGE ===");
for(const [date,tiers] of Object.entries(cnlData)){
  const total=Object.values(tiers).reduce((s,t)=>s+t.totalSales,0);
  const tables=Object.values(tiers).reduce((s,t)=>s+t.soldTables,0);
  console.log(`${date}: total=$${Math.round(total).toLocaleString()}, tables=${tables}`);
  for(const[t,v]of Object.entries(tiers)){if(v.soldTables>0)console.log(`  ${t}: ${v.soldTables}/${v.totalTables} tables, $${v.totalSales.toLocaleString()}, avg $${v.avgPerTable.toLocaleString()}`);}
}
console.log("\n=== MILA ===");
for(const [date,tiers] of Object.entries(milaData)){
  const total=Object.values(tiers).reduce((s,t)=>s+t.totalSales,0);
  const tables=Object.values(tiers).reduce((s,t)=>s+t.soldTables,0);
  console.log(`${date}: total=$${Math.round(total).toLocaleString()}, tables=${tables}`);
  for(const[t,v]of Object.entries(tiers)){if(v.soldTables>0)console.log(`  ${t}: ${v.soldTables}/${v.totalTables} tables, $${v.totalSales.toLocaleString()}, avg $${v.avgPerTable.toLocaleString()}`);}
}
