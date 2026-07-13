const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const page = await browser.newPage();

  await page.goto("https://pro.fourvenues.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Click Google sign-in button
  const googleBtn = await page.$('a[href*="google"], button:has-text("Google"), [class*="google"]');
  if(googleBtn){ await googleBtn.click(); await page.waitForTimeout(3000); }

  console.log("OAuth URL:", page.url().slice(0, 120));

  // Now on Google login - fill email
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', "matthias@rivieradininggroup.com");
  await page.click('button:has-text("Next"), #identifierNext');
  await page.waitForTimeout(3000);

  // Fill password
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  await page.fill('input[type="password"]', "MattLondon0401!");
  await page.click('button:has-text("Next"), #passwordNext');
  await page.waitForTimeout(6000);

  console.log("After Google auth:", page.url().slice(0, 120));
  await page.screenshot({ path: "C:\\Cursor\\fv-google-auth.png" });

  // Wait to land back on FourVenues
  try {
    await page.waitForURL("**/fourvenues.com/**", { timeout: 15000 });
    console.log("Landed on FourVenues:", page.url());
  } catch(e) {
    console.log("Still on:", page.url().slice(0,120));
    await page.screenshot({ path: "C:\\Cursor\\fv-stuck.png" });
  }

  await browser.close();
})();
