const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const sessionData = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json"));
  const ctx = await browser.newContext({ storageState: sessionData.storageState });
  const page = await ctx.newPage();

  const captured = {};
  page.on("response", async r => {
    const u = r.url();
    if(u.includes("api.fourvenues.com") && !u.includes(".js")){
      const body = await r.text().catch(()=>"");
      captured[u] = { status: r.status(), body: body.slice(0,2000) };
      if(body.length > 100 && r.status()===200 && !u.includes("sesion") && !u.includes("dispositivo") && !u.includes("notification"))
        console.log("["+r.status()+"]", u.slice(40,130), "->", body.slice(0,120));
    }
  });

  // Navigate to the sales-overview page
  await page.goto("https://pro.fourvenues.com/mila1/reports/sales-overview", { waitUntil:"domcontentloaded", timeout:30000 });
  await page.waitForTimeout(8000);
  console.log("URL:", page.url());
  await page.screenshot({ path: "C:\\Cursor\\fv-sales-overview.png", fullPage:true });

  // Try clicking Upcoming tab if events modal is visible
  const upcomingBtn = await page.$('button:has-text("Upcoming"), [data-tab="upcoming"]');
  if(upcomingBtn){ await upcomingBtn.click(); await page.waitForTimeout(2000); }

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-overview-calls.json", JSON.stringify(captured, null, 2));
  console.log("\nTotal API calls:", Object.keys(captured).length);
  await browser.close();
})();
