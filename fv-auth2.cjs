const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto("https://pro.fourvenues.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.click('button.is-red, button:has-text("Google")');
  await page.waitForURL("**/accounts.google.com/**", { timeout: 15000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  // Fill email
  await page.fill('#identifierId', "matthias@rivieradininggroup.com");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(4000);

  // Fill password - try second password
  const passEl = await page.$('input[type="password"]');
  if(passEl){
    await passEl.fill("Mattgsi56920!");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(8000);
  }

  await page.screenshot({ path: "C:\\Cursor\\fv-pass2.png" });
  console.log("URL after pass2:", page.url().slice(0,100));
  const txt = await page.$eval("body", el => el.innerText.slice(0,500)).catch(()=>"");
  console.log("Content:", txt.replace(/\n/g,' | ').slice(0,300));

  // If still on google, show what we need to do
  if(!page.url().includes("pro.fourvenues")){
    console.log("⚠ Authentication needs manual step. Please look at the browser window.");
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "C:\\Cursor\\fv-manual.png" });
  } else {
    // Navigate to the sales dashboard
    await page.goto("https://pro.fourvenues.com/casa-neos1/reports/dashboard-sales", { timeout: 20000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: "C:\\Cursor\\fv-sales.png", fullPage: true });
    console.log("Sales dashboard loaded");

    const state = await ctx.storageState();
    require("fs").writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-session.json", JSON.stringify(state));
    console.log("Session saved");
  }

  await browser.close();
})();
