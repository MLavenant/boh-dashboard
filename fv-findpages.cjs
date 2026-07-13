const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-session.json" });
  const page = await ctx.newPage();

  // Intercept all API calls to capture event data
  const apiData = {};
  page.on("response", async r => {
    const u = r.url();
    if(u.includes("api.fourvenues.com") || u.includes("connector-service")){
      try {
        const body = await r.text().catch(()=>"");
        if(body.length > 20) apiData[u] = body.slice(0,2000);
      } catch(e){}
    }
  });

  // Try events/bookings pages
  const pages = [
    "https://pro.fourvenues.com/casa-neos1/events",
    "https://pro.fourvenues.com/casa-neos1/bookings",
    "https://pro.fourvenues.com/casa-neos1/reservations",
    "https://pro.fourvenues.com/casa-neos1/agenda",
    "https://pro.fourvenues.com/casa-neos1/calendar",
  ];

  for(const url of pages){
    await page.goto(url, { timeout: 15000 }).catch(()=>{});
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    if(!currentUrl.includes("login") && !currentUrl.includes("id.fourvenues")){
      console.log("✅ Found page:", currentUrl);
      await page.screenshot({ path: `C:\\Cursor\\fv-${url.split("/").pop()}.png`, fullPage: true });
    } else {
      console.log("❌ Redirected to login:", url);
    }
  }

  // Also check the main dashboard for event list
  await page.goto("https://pro.fourvenues.com/casa-neos1", { timeout: 15000 }).catch(()=>{});
  await page.waitForTimeout(3000);
  console.log("Main page URL:", page.url());
  await page.screenshot({ path: "C:\\Cursor\\fv-main.png", fullPage: true });

  console.log("\nAPI calls:", Object.keys(apiData).join("\n"));
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-pages.json", JSON.stringify(apiData, null, 2));

  await browser.close();
})();
