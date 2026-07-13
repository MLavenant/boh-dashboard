const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto("https://pro.fourvenues.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });

  console.log("=================================================");
  console.log("BROWSER IS OPEN — please log in manually.");
  console.log("Click 'Continue with Google', sign in, then");
  console.log("navigate to the sales dashboard and wait.");
  console.log("=================================================");

  // Wait up to 3 minutes for user to log in and land on dashboard
  await page.waitForURL("**/pro.fourvenues.com/**", { timeout: 180000 });
  console.log("Logged in:", page.url());

  // Navigate to sales dashboard
  await page.goto("https://pro.fourvenues.com/casa-neos1/reports/dashboard-sales", { timeout: 20000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "C:\\Cursor\\fv-sales-dash.png", fullPage: true });
  console.log("On sales dashboard");

  // Save session
  const state = await ctx.storageState();
  require("fs").writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-session.json", JSON.stringify(state));
  console.log("✅ Session saved with", state.cookies.length, "cookies");

  await browser.close();
})();
