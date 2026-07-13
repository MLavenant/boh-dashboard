const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const page = await browser.newPage();

  // Go directly to login
  await page.goto("https://pro.fourvenues.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  console.log("Login page:", page.url());

  const emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="mail" i], input[placeholder*="user" i]');
  const passInput  = await page.$('input[type="password"]');

  if(emailInput && passInput){
    await emailInput.fill("matthias@rivieradininggroup.com");
    await passInput.fill("MattLondon0401!");
    await passInput.press("Enter");
    await page.waitForTimeout(5000);
    console.log("After login:", page.url());
  } else {
    // Try clicking login button first
    const loginBtn = await page.$('button, a[href*="login"]');
    if(loginBtn) await loginBtn.click();
    await page.waitForTimeout(2000);
    console.log("No direct form, URL:", page.url());
    await page.screenshot({ path: "C:\\Cursor\\fv-landing.png" });
    await browser.close(); return;
  }

  // Navigate to the dashboard-sales page
  await page.goto("https://pro.fourvenues.com/casa-neos1/reports/dashboard-sales", { timeout: 20000 });
  await page.waitForTimeout(4000);
  console.log("Dashboard URL:", page.url());
  await page.screenshot({ path: "C:\\Cursor\\fv-dash.png" });

  // Try to click "Upcoming" tab if present
  const upcoming = await page.$('button:has-text("Upcoming"), [data-tab="upcoming"], a:has-text("Upcoming")');
  if(upcoming){ await upcoming.click(); await page.waitForTimeout(2000); }

  // Get all text content from the page
  const events = await page.$$eval('[class*="event"], [class*="row"], tr, [data-event]', els =>
    els.map(e => e.innerText.trim()).filter(t => t.length > 5).slice(0, 50)
  );
  console.log("Events found:", events.length);
  events.forEach((e,i) => console.log(`[${i}] ${e.replace(/\n/g,' | ')}`));

  await page.screenshot({ path: "C:\\Cursor\\fv-dash-full.png", fullPage: true });
  await browser.close();
})();
