const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();

  // Go straight to the Google accounts page that FourVenues redirects to
  await page.goto("https://pro.fourvenues.com/login", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Find and click the Google button
  const allBtns = await page.$$eval('a, button', els => els.map(e=>({text:e.innerText.trim(), href:e.href||'', cls:e.className})));
  console.log("Buttons:", JSON.stringify(allBtns.slice(0,10)));
  await page.screenshot({ path: "C:\\Cursor\\fv-login-page.png" });

  await browser.close();
})();
