const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-session.json" });
  const page = await ctx.newPage();

  // Establish session
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), 20000);
    page.on("response", async r => {
      if(r.url().includes("sesiones")){ const b = await r.text().catch(()=>""); if(b.includes("true")){ clearTimeout(timer); resolve(); } }
    });
    page.goto("https://pro.fourvenues.com/mila1", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(()=>{});
  });
  await page.waitForTimeout(2000);
  console.log("Session ready");

  const BASE = "https://api.fourvenues.com";
  const H = {
    "storage-bucket": "pro",
    "referer": "https://pro.fourvenues.com/",
    "device-id": "Zzzwxt508tg69u21ul5d3enp3tKIcRPS",
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json",
    "app-id": "ajihln7fc0006jhmmi4lh75s2lI9O3jx",
  };

  const todaySec = Math.floor(Date.now() / 1000);
  const endSec = todaySec + 90 * 86400;

  // Use context.request which includes browser cookies
  const endpoints = [
    `/reservas/?query=${encodeURIComponent(JSON.stringify({fecha_evento:{$gte:todaySec,$lte:endSec}}))}&options=${encodeURIComponent(JSON.stringify({limit:20,sort:{fecha_evento:1}}))}`,
    `/reservas/?query=${encodeURIComponent(JSON.stringify({negocio_id:"Mmgkyvi0903mo01cm3vxg0phrtTEPpSM",fecha_evento:{$gte:todaySec}}))}&options=${encodeURIComponent(JSON.stringify({limit:20}))}`,
  ];

  for(const ep of endpoints){
    const r = await ctx.request.get(BASE + ep, { headers: H });
    const body = await r.text();
    console.log(`\n[${r.status()}] ${ep.slice(0,80)}`);
    console.log(body.slice(0,300));
  }

  await browser.close();
})();
