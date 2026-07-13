const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Intercept all XHR/fetch to log API calls
  const apiCalls = [];
  page.on("response", async r => {
    const u = r.url();
    if((u.includes("/api/") || u.includes("event") || u.includes("booking") || u.includes("sales")) && !u.includes("google")){
      try {
        const body = await r.text().catch(()=>"");
        apiCalls.push({ url: u.slice(0,150), status: r.status(), bodyLen: body.length, body: body.slice(0,500) });
      } catch(e){}
    }
  });

  await page.goto("https://pro.fourvenues.com/casa-neos1/reports/dashboard-sales", { waitUntil: "domcontentloaded", timeout: 30000 });

  console.log("=================================================");
  console.log("BROWSER OPEN — please sign in with Google.");
  console.log("After login, stay on the dashboard-sales page.");
  console.log("Waiting up to 3 minutes...");
  console.log("=================================================");

  // Wait until we're actually on the sales dashboard (not login)
  await page.waitForURL("**/reports/dashboard-sales**", { timeout: 180000 });
  console.log("✅ On dashboard:", page.url());
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "C:\\Cursor\\fv-sales-dash.png", fullPage: true });

  // Save working session
  const state = await ctx.storageState();
  require("fs").writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-session.json", JSON.stringify(state));
  console.log("✅ Session saved with", state.cookies.length, "cookies");
  console.log("API calls captured:", apiCalls.length);
  apiCalls.forEach((c,i) => console.log(`[${i}] ${c.status} ${c.url} (${c.bodyLen}b)`));
  require("fs").writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-api-calls.json", JSON.stringify(apiCalls, null, 2));

  await browser.close();
})();
