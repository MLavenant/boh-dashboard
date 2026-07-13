const { chromium } = require("playwright");
const fs = require("fs");

const APP_HDR = {
  "storage-bucket": "pro", "referer": "https://pro.fourvenues.com/",
  "device-id": "Q529vp56m4h2q395ia0i6xt0csuPejE3",
  "accept": "application/json, text/plain, */*", "content-type": "application/json",
  "app-id": "ajihln7fc0006jhmmi4lh75s2lI9O3jx",
};

(async () => {
  const browser = await chromium.launch({ headless: false });
  const sd = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json"));
  const ctx = await browser.newContext({ storageState: sd.storageState });
  const page = await ctx.newPage();

  await page.goto("https://pro.fourvenues.com/mila1/reports/sales-overview", { waitUntil:"domcontentloaded", timeout:30000 });
  await page.waitForTimeout(3000);

  const VENUE = {name:"Casa Neos Lounge", id:"mrph20a941lojvdykvq598p0b8j3576j", slug:"casa-neos-lounge"};
  const todaySec = Math.floor(Date.now()/1000);

  const evQ = JSON.stringify({negocio_id:VENUE.id,eliminado:0,cancelado:0,fecha:{"$gte":todaySec-86400}});
  const evR = await ctx.request.get("https://api.fourvenues.com/eventos/?query="+encodeURIComponent(evQ)+"&options="+encodeURIComponent(JSON.stringify({limit:30,sort:{fecha:1}})), { headers: APP_HDR });
  let events = [];
  try { events = (await evR.json()).data || []; } catch(e){}
  console.log("CN Lounge: "+events.length+" events");

  const eventsData = [];
  for(const evt of events){
    const evDate = new Date(evt.fecha*1000).toISOString().split("T")[0];
    const captured = {};
    const captureHandler = async(r) => {
      const u = r.url();
      if(u.includes("api.fourvenues.com") && r.status()===200 && (u.includes("reservados_mapa")||u.includes("bookings_kpis"))){
        const body = await r.text().catch(()=>"");
        if(body.length>10) captured[u] = body;
      }
    };
    page.on("response", captureHandler);
    await page.goto("https://pro.fourvenues.com/"+VENUE.slug+"/"+evt._id+"/sales/bookings", { waitUntil:"domcontentloaded", timeout:20000 }).catch(()=>{});
    await page.waitForTimeout(3500);
    page.off("response", captureHandler);

    let mapData=null, kpiData=null;
    for(const [url, body] of Object.entries(captured)){
      try {
        if(url.includes("reservados_mapa")) mapData=JSON.parse(body);
        if(url.includes("bookings_kpis")) kpiData=JSON.parse(body);
      } catch(e){}
    }

    if(mapData||kpiData) console.log("  ✅ "+evDate+" "+evt.nombre);
    else console.log("  ⚪ "+evDate+" "+evt.nombre);
    eventsData.push({ date:evDate, name:evt.nombre, id:evt._id, mapData, kpiData });
  }

  // Load existing data and update CN Lounge
  const allData = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-bookings-data.json"));
  allData["Casa Neos Lounge"] = eventsData;
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-bookings-data.json", JSON.stringify(allData, null, 2));
  console.log("\n✅ Done — CN Lounge updated in fv-bookings-data.json");
  await browser.close();
})();
