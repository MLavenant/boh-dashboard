const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const session = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-session.json"));
  console.log("Cookies:", session.cookies.map(c=>c.name).join(", "));

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-session.json" });
  const page = await ctx.newPage();

  await page.goto("https://pro.fourvenues.com/casa-neos1/reports/dashboard-sales", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log("URL:", page.url());
  await page.screenshot({ path: "C:\\Cursor\\fv-sales-check.png", fullPage: true });

  if(page.url().includes("login")){
    console.log("❌ Not authenticated - session invalid");
  } else {
    console.log("✅ Authenticated!");
    // Intercept API calls to find events data
    const responses = [];
    page.on("response", async r => {
      if(r.url().includes("/api/") || r.url().includes("event") || r.url().includes("booking")){
        try { responses.push({ url: r.url(), status: r.status() }); } catch(e){}
      }
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(5000);
    console.log("API calls seen:", responses.map(r=>r.url.slice(0,100)).join("\n"));
  }

  await browser.close();
})();
