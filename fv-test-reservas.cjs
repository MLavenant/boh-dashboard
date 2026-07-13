const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-session.json" });
  const page = await ctx.newPage();

  // Wait for user session
  await new Promise(resolve => {
    const t = setTimeout(resolve, 25000);
    page.on("response", async r => {
      if(r.url().includes("sesiones")){
        const b = await r.text().catch(()=>"");
        if(b.includes("true")){ clearTimeout(t); console.log("✅ Session established"); resolve(); }
      }
    });
    page.goto("https://pro.fourvenues.com/mila1", { waitUntil:"domcontentloaded", timeout:25000 }).catch(()=>{});
  });
  await page.waitForTimeout(2000);

  const todaySec = Math.floor(Date.now() / 1000);
  const VENUES = {
    "MILA Lounge": "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM",
    "Casa Neos BC": "lah0f2isk8qmsg0zapu016rarffvp0xz",
    "Casa Neos Lounge": "mrph20a941lojvdykvq598p0b8j3576j",
  };

  const results = {};
  for(const [name, vid] of Object.entries(VENUES)){
    const q = JSON.stringify({ negocio_id: vid, fecha_evento: { "$gte": todaySec } });
    const opts = JSON.stringify({ limit: 100, sort: { fecha_evento: 1 } });
    const r = await ctx.request.get(
      `https://api.fourvenues.com/reservas/?query=${encodeURIComponent(q)}&options=${encodeURIComponent(opts)}`,
      { headers: { "storage-bucket":"pro","device-id":"Zzzwxt508tg69u21ul5d3enp3tKIcRPS","accept":"application/json","content-type":"application/json","app-id":"ajihln7fc0006jhmmi4lh75s2lI9O3jx" }}
    );
    const body = await r.text();
    console.log(`\n${name}: [${r.status()}] ${body.slice(0,200)}`);
    try { results[name] = JSON.parse(body); } catch(e){ results[name] = { raw: body.slice(0,100) }; }
  }

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-reservas-all.json", JSON.stringify(results, null, 2));
  console.log("\n✅ Saved to fv-reservas-all.json");
  await browser.close();
})();
