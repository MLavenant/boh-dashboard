const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-full-session.json" });
  const page = await ctx.newPage();

  // Intercept JWT from get_access_token.php
  let jwt = null;
  page.on("response", async r => {
    if(r.url().includes("get_access_token")){
      jwt = (await r.text().catch(()=>"")).trim();
      console.log("Got JWT:", jwt.slice(0,50) + "...");
    }
  });

  await page.goto("https://pro.fourvenues.com/casa-neos1/reports/dashboard-sales", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  if(!jwt){ console.log("❌ No JWT - session invalid"); await browser.close(); return; }

  // Decode JWT to check expiry
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString());
  console.log("App ID:", payload.appId, "Expires:", new Date(payload.exp*1000).toISOString());

  // Call events API using fetch from page context (fresh JWT available)
  const today = new Date().toISOString().split("T")[0];
  const results = await page.evaluate(async (jwt) => {
    const headers = { "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" };
    const out = {};

    // Try multiple event/booking endpoints
    const eps = [
      "https://api.fourvenues.com/eventos/?query={}&options={\"limit\":50,\"sort\":{\"fecha\":1}}",
      "https://api.fourvenues.com/eventos/?query={\"upcoming\":true}&options={\"limit\":50}",
      "https://api.fourvenues.com/programaciones/?query={}&options={\"limit\":50,\"sort\":{\"fecha\":1}}",
      "https://api.fourvenues.com/actuaciones/?query={}&options={\"limit\":50}",
      "https://api.fourvenues.com/shows/?query={}&options={\"limit\":50}",
    ];

    for(const url of eps){
      try {
        const r = await fetch(url, { headers });
        const body = await r.text();
        out[url.slice(30,80)] = { status: r.status, body: body.slice(0,500) };
      } catch(e){ out[url.slice(30,80)] = { error: e.message }; }
    }
    return out;
  }, jwt);

  console.log("\n=== Event API Results ===");
  for(const [k,v] of Object.entries(results)){
    console.log(`\n[${v.status||'err'}] ${k}`);
    console.log(v.body || v.error);
  }

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-events-result.json", JSON.stringify(results, null, 2));
  await browser.close();
})();
