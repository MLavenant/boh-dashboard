const { chromium } = require("playwright");
const fs = require("fs");

const APP_HDR = {
  "storage-bucket": "pro",
  "referer": "https://pro.fourvenues.com/",
  "device-id": "Q529vp56m4h2q395ia0i6xt0csuPejE3",
  "accept": "application/json, text/plain, */*",
  "content-type": "application/json",
  "app-id": "ajihln7fc0006jhmmi4lh75s2lI9O3jx",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

const VENUES = [
  {name:"MILA Lounge", id:"Mmgkyvi0903mo01cm3vxg0phrtTEPpSM", slug:"mila1"},
  {name:"Casa Neos BC", id:"lah0f2isk8qmsg0zapu016rarffvp0xz", slug:"casa-neos1"},
  {name:"Casa Neos Lounge", id:"mrph20a941lojvdykvq598p0b8j3576j", slug:"casa-neos-lounge1"},
];

(async () => {
  const browser = await chromium.launch({ headless: false });
  const sd = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json"));
  const ctx = await browser.newContext({ storageState: sd.storageState });
  const page = await ctx.newPage();
  
  // Warm up session by navigating to login page
  await page.goto("https://pro.fourvenues.com/mila1/reports/sales-overview", { waitUntil:"domcontentloaded", timeout:30000 });
  await page.waitForTimeout(4000);
  
  const todaySec = Math.floor(Date.now()/1000);
  const allData = {};

  for(const v of VENUES){
    // Get upcoming events using app headers
    const evQ = JSON.stringify({negocio_id:v.id,eliminado:0,cancelado:0,fecha:{"$gte":todaySec}});
    const evR = await ctx.request.get("https://api.fourvenues.com/eventos/?query="+encodeURIComponent(evQ)+"&options="+encodeURIComponent(JSON.stringify({limit:30,sort:{fecha:1}})), { headers: APP_HDR });
    const evText = await evR.text();
    let events = [];
    try { events = JSON.parse(evText).data || []; } catch(e){}
    console.log(v.name+": "+evR.status()+" / "+events.length+" events");

    // For each upcoming event, navigate to its booking page and capture data
    const eventsData = [];
    for(const evt of events.slice(0,5)){
      const evDate = new Date(evt.fecha*1000).toLocaleDateString();
      
      // Navigate to event booking page
      const eventCapture = {};
      const captureHandler = async(r) => {
        if(r.url().includes("api.fourvenues.com") && r.status()===200 && 
           (r.url().includes("reserva") || r.url().includes("booking") || r.url().includes("venta"))){
          const body = await r.text().catch(()=>"");
          if(body.length>50) eventCapture[r.url()] = body;
        }
      };
      page.on("response", captureHandler);
      await page.goto(`https://pro.fourvenues.com/${v.slug}/${evt._id}/sales/bookings`, { waitUntil:"domcontentloaded", timeout:20000 }).catch(()=>{});
      await page.waitForTimeout(4000);
      page.off("response", captureHandler);

      const capKeys = Object.keys(eventCapture);
      if(capKeys.length > 0) {
        console.log("  "+evDate+" "+evt.nombre+": captured "+capKeys.length+" endpoints:");
        capKeys.forEach(u=>console.log("    "+u.slice(30,120)));
        eventsData.push({ event:evt, capture: eventCapture });
      } else {
        console.log("  "+evDate+" "+evt.nombre+": no reservation data captured");
        eventsData.push({ event:evt, capture: null });
      }
    }
    allData[v.name] = eventsData;
  }

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-bookings-data.json", JSON.stringify(allData, null, 2));
  console.log("\n✅ Done");
  await browser.close();
})();
