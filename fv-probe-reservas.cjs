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
  
  // Get an actual MILA event ID
  const evRes = await ctx.request.get(`${BASE}/eventos/?query=${encodeURIComponent(JSON.stringify({negocio_id:MILA,eliminado:0,cancelado:0,fecha:{$gte:Math.floor(Date.now()/1000)}})}&options=${encodeURIComponent(JSON.stringify({limit:3,sort:{fecha:1}}))}`, {headers:HDR});
  const events = JSON.parse(await evRes.text()).data || [];
  const eventId = events[0]?._id;
  console.log("Event ID for test:", eventId, events[0]?.nombre);

  // Try many different query formats
  const queries = [
    `{}`,
    `{"evento_id":"${eventId}"}`,
    `{"evento_id":"${eventId}","estado":"aceptada"}`,
    `{"negocio_id":"${MILA}"}`,
    `{"fecha":{"$gte":${Math.floor(Date.now()/1000)}}}`,
    `{"negocio_id":"${MILA}","tipo":"mesa"}`,
  ];

  for(const q of queries){
    const r = await ctx.request.get(`${BASE}/reservas/?query=${encodeURIComponent(q)}&options=${encodeURIComponent(JSON.stringify({limit:5}))}`, {headers:HDR});
    const body = await r.text();
    console.log(`[${r.status()}] q=${q.slice(0,50)}: ${body.slice(0,150)}`);
  }

  // Also try paginated approach
  const r2 = await ctx.request.get(`${BASE}/reservas/?query=${encodeURIComponent(JSON.stringify({evento_id:eventId}))}&options=${encodeURIComponent(JSON.stringify({limit:5,skip:0}))}`, {headers:HDR});
  console.log("\nWith skip/limit:", r2.status(), (await r2.text()).slice(0,200));

  await browser.close();
})();
