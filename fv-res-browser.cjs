const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-session.json" });
  const page = await ctx.newPage();

  // Wait for sesiones to establish user session
  await new Promise(resolve => {
    page.on("response", async r => {
      if(r.url().includes("sesiones")){ const b = await r.text().catch(()=>""); if(b.includes("true")) resolve(); }
    });
    page.goto("https://pro.fourvenues.com/mila1/reports/dashboard-sales", { waitUntil: "domcontentloaded", timeout: 30000 });
  });
  await page.waitForTimeout(2000);
  console.log("Session established, querying reservations...");

  const todaySec = Math.floor(Date.now() / 1000);
  const endSec = todaySec + 90 * 86400;

  // Call reservations from browser (cookies auto-included)
  const results = await page.evaluate(async ({ todaySec, endSec }) => {
    const BASE = "https://api.fourvenues.com";
    const HDR = { "accept": "application/json, text/plain, */*", "content-type": "application/json" };

    // Test different reservation endpoints
    const tests = [
      `/reservas/?query=${encodeURIComponent(JSON.stringify({fecha_evento:{$gte:todaySec,$lte:endSec}}))}&options=${encodeURIComponent(JSON.stringify({limit:20,sort:{fecha_evento:1}}))}`,
      `/reservas/?query=${encodeURIComponent(JSON.stringify({tipo:"vip"}))}&options=${encodeURIComponent(JSON.stringify({limit:5}))}`,
      `/reservas/?query=${encodeURIComponent(JSON.stringify({}))}&options=${encodeURIComponent(JSON.stringify({limit:5}))}`,
    ];

    const out = [];
    for(const path of tests){
      const r = await fetch(BASE + path, { credentials: "include", headers: HDR });
      const body = await r.text();
      out.push({ path: path.slice(0,80), status: r.status, body: body.slice(0,300) });
    }
    return out;
  }, { todaySec, endSec });

  results.forEach(r => console.log(`[${r.status}] ${r.path}\n  ${r.body.slice(0,150)}`));

  await browser.close();
})();
