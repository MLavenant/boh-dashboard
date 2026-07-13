const { chromium, request } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const sessionData = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json"));
  const ctx = await browser.newContext({ storageState: sessionData.storageState });
  const page = await ctx.newPage();

  // Capture fresh headers from real page request
  let captured = null;
  page.on("request", r => {
    if(r.url().includes("api.fourvenues.com/reports/sales-report") && !captured) {
      captured = r.headers();
    }
  });

  await page.goto("https://pro.fourvenues.com/mila1/reports/sales-overview", { waitUntil:"domcontentloaded", timeout:30000 });
  await page.waitForTimeout(6000);

  if(!captured) { console.error("No auth headers captured"); await browser.close(); process.exit(1); }
  console.log("Got session-id:", captured["session-id"].slice(0,10)+"...");

  // Use ctx.request to make calls - this sends cookies too
  const apiCtx = ctx.request;
  const HDR_BASE = {
    "user-id": captured["user-id"],
    "device-id": captured["device-id"],
    "session-id": captured["session-id"],
    "app-id": captured["app-id"],
    "accept": "application/json",
    "referer": "https://pro.fourvenues.com/",
  };

  const VENUES = [
    {name:"MILA Lounge", id:"Mmgkyvi0903mo01cm3vxg0phrtTEPpSM", slug:"mila1"},
    {name:"Casa Neos BC", id:"lah0f2isk8qmsg0zapu016rarffvp0xz", slug:"casa-neos1"},
    {name:"Casa Neos Lounge", id:"mrph20a941lojvdykvq598p0b8j3576j", slug:"casa-neos-lounge1"},
  ];
  const today = new Date().toISOString().split("T")[0];
  const future = new Date(Date.now()+90*86400000).toISOString().split("T")[0];

  const allData = {};
  for(const v of VENUES){
    console.log("\n=== "+v.name+" ===");
    // 1. Get upcoming events (public)
    const evQ = {negocio_id:v.id,eliminado:0,cancelado:0,fecha:{"$gte":Math.floor(Date.now()/1000)}};
    const evR = await apiCtx.get("https://api.fourvenues.com/eventos/?query="+encodeURIComponent(JSON.stringify(evQ))+"&options="+encodeURIComponent(JSON.stringify({limit:50,sort:{fecha:1}})), {headers:HDR_BASE});
    const evJson = await evR.json();
    const events = evJson.data || [];
    console.log(events.length+" upcoming events");

    // 2. Get reservations for upcoming events
    const eventsWithRes = [];
    for(const evt of events.slice(0,15)){
      const rQ = {evento_id:evt._id,estado:"aceptada"};
      const rR = await apiCtx.get("https://api.fourvenues.com/reservas/?query="+encodeURIComponent(JSON.stringify(rQ))+"&options="+encodeURIComponent(JSON.stringify({limit:500})), {headers:{...HDR_BASE,"content-type":"application/json"}});
      const rText = await rR.text().catch(()=>"");
      let rJson; try{rJson=JSON.parse(rText);}catch(e){rJson={data:[]};}
      const reservations = rJson.data || [];
      const date = new Date(evt.fecha*1000).toLocaleDateString();
      const total = reservations.reduce((s,r)=>s+(r.minimo||0),0);
      if(rR.status()!==200) console.log("  ["+rR.status()+"] "+date+" "+evt.nombre+": "+rText.slice(0,100));
      else console.log("  ["+rR.status()+"] "+date+" "+evt.nombre+": "+reservations.length+" bookings, min=$"+total);
      if(reservations.length>0 && eventsWithRes.length===0) {
        console.log("  Sample reservation fields:", Object.keys(reservations[0]).join(", "));
        console.log("  Sample:", JSON.stringify(reservations[0]).slice(0,300));
      }
      eventsWithRes.push({ eventId:evt._id, name:evt.nombre, date:new Date(evt.fecha*1000).toISOString().split("T")[0], reservations });
    }
    allData[v.name] = eventsWithRes;
  }

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-reservations2.json", JSON.stringify(allData, null, 2));
  console.log("\n✅ Done");
  await browser.close();
})();
