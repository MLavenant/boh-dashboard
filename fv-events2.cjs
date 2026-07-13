const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-session.json" });
  const page = await ctx.newPage();

  // Capture ALL network requests with full bodies
  const allCalls = [];
  page.on("response", async r => {
    const u = r.url();
    if(u.includes("fourvenues.com") && !u.includes("tableau") && !u.includes(".js") && !u.includes(".css")){
      try {
        const body = await r.text().catch(()=>"");
        allCalls.push({ url: u.slice(0,200), status: r.status(), body: body.slice(0,1000) });
      } catch(e){}
    }
  });

  await page.goto("https://pro.fourvenues.com/casa-neos1/reports/dashboard-sales", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log("=== All FourVenues calls ===");
  allCalls.forEach(c => {
    console.log(`\n[${c.status}] ${c.url}`);
    if(c.body) console.log("Body:", c.body.slice(0,200));
  });

  // Now try to call the API from page context (cookies included)
  const today = "2026-07-11";
  const results = await page.evaluate(async (today) => {
    const endpoints = [
      `/casa-neos1/api/events?upcoming=true`,
      `/api/v1/events?date_from=${today}&upcoming=true`,
      `/casa-neos1/api/bookings?upcoming=true`,
    ];
    const out = [];
    for(const ep of endpoints){
      try {
        const r = await fetch("https://pro.fourvenues.com" + ep, { credentials: "include" });
        out.push({ url: ep, status: r.status, body: (await r.text()).slice(0,300) });
      } catch(e){ out.push({ url: ep, error: e.message }); }
    }
    return out;
  }, today);

  console.log("\n=== Direct API probes ===");
  results.forEach(r => console.log(JSON.stringify(r)));

  // Try the api.fourvenues.com with cookies
  const apiResults = await page.evaluate(async () => {
    const eps = [
      "https://api.fourvenues.com/sesion/?query={}&options={%22disableCache%22:true}",
      "https://api.fourvenues.com/eventos/?query={%22upcoming%22:true}&options={%22limit%22:20}",
      "https://api.fourvenues.com/eventos/?query={}&options={%22limit%22:20,%22sort%22:{%22fecha%22:1}}",
    ];
    const out = [];
    for(const url of eps){
      const r = await fetch(url, { credentials: "include" });
      out.push({ url: url.slice(0,100), status: r.status, body: (await r.text()).slice(0,500) });
    }
    return out;
  });

  console.log("\n=== API calls with session cookies ===");
  apiResults.forEach(r => console.log(JSON.stringify(r)));

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-network.json", JSON.stringify({allCalls, apiResults}, null, 2));
  await browser.close();
})();
