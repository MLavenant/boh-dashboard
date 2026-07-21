const { chromium } = require("playwright");

/**
 * Dev helper — uses FV_EMAIL / FV_PASSWORD from env (never hardcode secrets).
 */
(async () => {
  const email = process.env.FV_EMAIL;
  const password = process.env.FV_PASSWORD;
  if (!email || !password) {
    console.error("Set FV_EMAIL and FV_PASSWORD");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const page = await browser.newPage();

  await page.goto("https://pro.fourvenues.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  const googleBtn = await page.$('a[href*="google"], button:has-text("Google"), [class*="google"]');
  if (googleBtn) { await googleBtn.click(); await page.waitForTimeout(3000); }

  console.log("OAuth URL:", page.url().slice(0, 120));

  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', email);
  await page.click('button:has-text("Next"), #identifierNext');
  await page.waitForTimeout(3000);

  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Next"), #passwordNext');
  await page.waitForTimeout(6000);

  console.log("After Google auth:", page.url().slice(0, 120));
  await page.screenshot({ path: "fv-google-auth.png" });

  try {
    await page.waitForURL("**/fourvenues.com/**", { timeout: 15000 });
    console.log("Landed on FourVenues:", page.url());
  } catch (e) {
    console.log("Still on:", page.url().slice(0, 120));
    await page.screenshot({ path: "fv-stuck.png" });
  }

  await browser.close();
})();
