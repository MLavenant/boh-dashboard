const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Log ALL responses to understand auth flow
  const captured = { apiCalls: [], events: [] };
  page.on("response", async r => {
    const u = r.url();
    if(u.includes("fourvenues.com") && !u.includes(".js") && !u.includes(".css") && !u.includes(".png") && !u.includes(".woff") && !u.includes(".svg") && !u.includes(".jpg") && !u.includes(".wasm") && !u.includes("collect") && !u.includes("analytics")){
      try {
        const body = await r.text().catch(()=>"");
        if(body.length > 5) {
          captured.apiCalls.push({ url: u.slice(0,200), status: r.status(), body: body.slice(0,1000) });
          // Look for event data
          if(body.includes("dj") || body.includes("evento") || body.includes("event") || body.includes("artist") || body.includes("booking")){
            captured.events.push({ url: u.slice(0,200), body: body.slice(0,2000) });
            console.log("🎉 EVENT DATA:", u.slice(0,100));
          }
        }
      } catch(e){}
    }
  });

  await page.goto("https://pro.fourvenues.com/casa-neos1/reports/dashboard-sales");

  console.log("=================================================");
  console.log("Please log in with Google when the window opens.");
  console.log("After login, stay on the sales dashboard.");
  console.log("=================================================");

  await page.waitForURL("**/reports/dashboard-sales**", { timeout: 180000 });
  console.log("✅ On dashboard");
  await page.waitForTimeout(8000); // Wait for all API calls to fire

  // Save full session with ALL domains
  const allCookies = await ctx.cookies([
    "https://pro.fourvenues.com",
    "https://api.fourvenues.com",
    "https://id.fourvenues.com",
    "https://connector-service.fourvenues.com"
  ]);
  console.log("All cookies:", allCookies.map(c=>`${c.domain}:${c.name}`).join(", "));

  const ls = await page.evaluate(() => {
    const o = {};
    for(let i=0;i<localStorage.length;i++) o[localStorage.key(i)] = localStorage.getItem(i);
    return o;
  });

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-full-session.json", JSON.stringify({ cookies: allCookies, localStorage: ls }, null, 2));
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-captured.json", JSON.stringify(captured, null, 2));

  console.log("API calls:", captured.apiCalls.length);
  console.log("Event data found:", captured.events.length);
  captured.apiCalls.forEach(c => console.log(`[${c.status}] ${c.url.slice(0,100)}: ${c.body.slice(0,100)}`));

  await browser.close();
})();
