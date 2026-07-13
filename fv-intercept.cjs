const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-full-session.json" });
  const page = await ctx.newPage();

  const capturedRequests = [];
  page.on("request", r => {
    if(r.url().includes("api.fourvenues.com")){
      capturedRequests.push({ url: r.url().slice(0,200), method: r.method(), headers: r.headers() });
    }
  });
  const capturedResponses = [];
  page.on("response", async r => {
    if(r.url().includes("api.fourvenues.com")){
      try {
        const body = await r.text();
        if(body.length > 20) capturedResponses.push({ url: r.url().slice(0,150), status: r.status(), body: body.slice(0,500) });
      } catch(e){}
    }
  });

  // Navigate to MILA's event/reservations page
  const milaEventUrl = "https://pro.fourvenues.com/mila1/events/of26x5gux3si5w13x53v9pf2byf2qspt/reservations";
  await page.goto(milaEventUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log("Page URL:", page.url());

  // Also try the general events list
  await page.goto("https://pro.fourvenues.com/mila1/events", { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(3000);

  console.log("\n=== API Requests made ===");
  capturedRequests.forEach(r => {
    const authHeaders = Object.fromEntries(Object.entries(r.headers).filter(([k])=>
      ['authorization','session-id','user-id','token','x-token','cookie'].includes(k.toLowerCase())
    ));
    if(Object.keys(authHeaders).length) console.log(r.url.slice(0,80), JSON.stringify(authHeaders));
  });

  console.log("\n=== API Responses with data ===");
  capturedResponses.forEach(r => {
    if(r.body.includes("reserva") || r.body.includes("mesa") || r.body.includes("booking") || r.status !== 200)
      console.log(`[${r.status}] ${r.url.slice(0,80)}: ${r.body.slice(0,150)}`);
  });

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-auth-headers.json", JSON.stringify(capturedRequests, null, 2));
  await browser.close();
})();
