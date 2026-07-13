const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  let sessionSet = false;
  page.on("response", async r => {
    if(r.url().includes("sesiones") && !sessionSet){
      const b = await r.text().catch(()=>"");
      if(b.includes("true")){
        sessionSet = true;
        // Capture api.fourvenues.com cookies RIGHT NOW
        const apiCookies = await ctx.cookies("https://api.fourvenues.com");
        console.log("api.fourvenues.com cookies after sesiones:", apiCookies.map(c=>c.name+"="+c.value.slice(0,20)).join(", "));
        const proCookies = await ctx.cookies("https://pro.fourvenues.com");
        const allCookies = await ctx.cookies();
        console.log("All domain cookies:", [...new Set(allCookies.map(c=>c.domain))].join(", "));
        console.log("Total cookies:", allCookies.length);
        fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-post-sesiones-cookies.json", JSON.stringify(allCookies, null, 2));
      }
    }
  });

  await page.goto("https://pro.fourvenues.com/mila1/reports/dashboard-sales");
  console.log("=================================================");
  console.log("BROWSER OPEN — please log in with Google.");
  console.log("Waiting for session to be established...");
  console.log("=================================================");

  await page.waitForURL("**/reports/dashboard-sales**", { timeout: 180000 });
  console.log("✅ On dashboard:", page.url());
  await page.waitForTimeout(5000); // Wait for all API calls

  // Final capture of all cookies
  const allCookies = await ctx.cookies();
  const state = await ctx.storageState();
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json", JSON.stringify({ storageState: state, allCookies }, null, 2));
  console.log("✅ Saved. Total cookies:", allCookies.length);
  console.log("Domains:", [...new Set(allCookies.map(c=>c.domain))].join(", "));

  await browser.close();
})();
