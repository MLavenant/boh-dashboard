const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-session.json" });
  const page = await ctx.newPage();

  await new Promise(resolve => {
    const t = setTimeout(resolve, 20000);
    page.on("response", async r => {
      if(r.url().includes("sesiones")){ const b = await r.text().catch(()=>""); if(b.includes("true")){ clearTimeout(t); resolve(); } }
    });
    page.goto("https://pro.fourvenues.com/mila1", { waitUntil:"domcontentloaded", timeout:20000 }).catch(()=>{});
  });
  await page.waitForTimeout(1000);

  const HDR = { "storage-bucket":"pro","device-id":"Zzzwxt508tg69u21ul5d3enp3tKIcRPS","accept":"application/json","content-type":"application/json","app-id":"ajihln7fc0006jhmmi4lh75s2lI9O3jx" };
  const BASE = "https://api.fourvenues.com";
  const MILA = "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM";
  const todaySec = Math.floor(Date.now()/1000);

  // Get event ID
  const evQ = JSON.stringify({negocio_id:MILA,eliminado:0,cancelado:0,fecha:{"$gte":todaySec}});
  const evOpts = JSON.stringify({limit:3,sort:{fecha:1}});
  const evRes = await ctx.request.get(BASE+"/eventos/?query="+encodeURIComponent(evQ)+"&options="+encodeURIComponent(evOpts), {headers:HDR});
  const events = JSON.parse(await evRes.text()).data || [];
  const eventId = events[0] && events[0]._id;
  console.log("Event:", eventId, events[0] && events[0].nombre);

  // Different reservas queries
  const tests = [
    ["empty", "{}"],
    ["by evento_id", JSON.stringify({evento_id:eventId})],
    ["by negocio_id", JSON.stringify({negocio_id:MILA})],
    ["by fecha", JSON.stringify({fecha:{"$gte":todaySec}})],
    ["tipo mesa", JSON.stringify({tipo:"mesa"})],
    ["tipo vip", JSON.stringify({tipo:"vip"})],
  ];

  for(const [label, q] of tests){
    const opts = JSON.stringify({limit:5});
    const r = await ctx.request.get(BASE+"/reservas/?query="+encodeURIComponent(q)+"&options="+encodeURIComponent(opts), {headers:HDR});
    const body = await r.text();
    console.log("["+r.status()+"] "+label+": "+body.slice(0,150));
  }

  await browser.close();
})();
