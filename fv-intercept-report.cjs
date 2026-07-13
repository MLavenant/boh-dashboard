const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const sessionData = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json"));
  const ctx = await browser.newContext({ storageState: sessionData.storageState });
  const page = await ctx.newPage();

  // Capture REQUEST details for sales-report
  const reportRequests = [];
  page.on("request", r => {
    if(r.url().includes("sales-report") || r.url().includes("bookings-report") || r.url().includes("reports/")){
      reportRequests.push({ url: r.url(), method: r.method(), headers: r.headers(), postData: r.postData() });
    }
  });
  page.on("response", async r => {
    if(r.url().includes("reports/")){
      const body = await r.text().catch(()=>"");
      const req = reportRequests.find(x=>x.url===r.url());
      if(req) req.response = { status: r.status(), body };
    }
  });

  await page.goto("https://pro.fourvenues.com/mila1/reports/sales-overview", { waitUntil:"domcontentloaded", timeout:30000 });
  await page.waitForTimeout(8000);

  console.log("=== Sales Report Requests ===");
  reportRequests.forEach(r => {
    console.log("\nURL:", r.url.slice(0,150));
    console.log("Method:", r.method);
    console.log("Headers:", JSON.stringify(Object.fromEntries(Object.entries(r.headers).filter(([k])=>!k.startsWith('sec-')&&!k.startsWith('accept-encoding')&&k!=='user-agent'))));
    if(r.postData) console.log("POST Body:", r.postData.slice(0,500));
    if(r.response) console.log("Response:", r.response.body.slice(0,200));
  });

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-report-requests.json", JSON.stringify(reportRequests, null, 2));
  await browser.close();
})();
