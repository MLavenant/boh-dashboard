const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const sd = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json"));
  const ctx = await browser.newContext({ storageState: sd.storageState });
  const page = await ctx.newPage();

  const captured = {};
  page.on("response", async r => {
    if(r.url().includes("api.fourvenues.com") && r.status()===200){
      const body = await r.text().catch(()=>"");
      if(body.length > 100 && !r.url().includes("sesion") && !r.url().includes("notification")) {
        captured[r.url()] = { status: r.status(), body };
      }
    }
  });

  // 1. MILA Lounge - current week
  console.log("Navigating MILA sales overview...");
  await page.goto("https://pro.fourvenues.com/mila1/reports/sales-overview", { waitUntil:"domcontentloaded", timeout:30000 });
  await page.waitForTimeout(6000);

  // Screenshot to see the page
  await page.screenshot({ path: "C:\\Cursor\\fv-mila-overview.png" });
  console.log("Page URL:", page.url());
  console.log("Page title:", await page.title());

  // Check if we're logged in
  const content = await page.content();
  if(content.includes("login") || content.includes("Login")) {
    console.log("NOT LOGGED IN!");
  }

  console.log("Captured API calls:", Object.keys(captured).length);
  Object.keys(captured).forEach(u => console.log("  "+u.slice(30,120)));

  // Try to find and click date range picker
  const dateInputs = await page.$$('input[type="date"], [class*="date"], [class*="calendar"], button[class*="date"]');
  console.log("Date inputs found:", dateInputs.length);

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-mila-calls.json", JSON.stringify(captured, null, 2));
  console.log("Saved calls");
  await page.waitForTimeout(3000);
  await browser.close();
})();
