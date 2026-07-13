const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto("https://pro.fourvenues.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Click Continue with Google
  await page.click('button.is-red, button:has-text("Google")');
  console.log("Clicked Google, waiting for redirect...");

  // Wait for Google page
  await page.waitForURL("**/accounts.google.com/**", { timeout: 15000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);
  console.log("On Google:", page.url().slice(0,80));
  await page.screenshot({ path: "C:\\Cursor\\fv-google1.png" });

  // Fill email - try multiple selectors
  await page.waitForTimeout(1000);
  const emailSels = ['input[type="email"]', '#identifierId', 'input[name="identifier"]'];
  for(const sel of emailSels){
    const el = await page.$(sel);
    if(el){ console.log("Found email input:", sel); await el.fill("matthias@rivieradininggroup.com"); break; }
  }
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "C:\\Cursor\\fv-google2.png" });
  console.log("After email:", page.url().slice(0,80));

  // Fill password
  const passSels = ['input[type="password"]', 'input[name="password"]', 'input[name="Passwd"]'];
  for(const sel of passSels){
    const el = await page.$(sel);
    if(el){ console.log("Found pass input:", sel); await el.fill("MattLondon0401!"); break; }
  }
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(8000);
  await page.screenshot({ path: "C:\\Cursor\\fv-google3.png" });
  console.log("After password:", page.url().slice(0,80));

  // Check if landed on FourVenues
  if(page.url().includes("fourvenues.com")){
    console.log("SUCCESS - on FourVenues:", page.url());
    // Save cookies
    const cookies = await ctx.cookies();
    require("fs").writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-session.json", JSON.stringify(cookies,null,2));
    console.log("Session saved with", cookies.length, "cookies");
  } else {
    console.log("Still on:", page.url().slice(0,80));
    // Show what's on screen
    const txt = await page.$eval("body", el => el.innerText.slice(0,300));
    console.log("Page content:", txt.replace(/\n/g,' '));
  }

  await browser.close();
})();
