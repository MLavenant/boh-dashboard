import { chromium } from "C:/Cursor/toast-mcp-server/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ headless: false, slowMo: 300 });
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto("https://app.fourvenues.com", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3000);
console.log("Landed:", page.url());
await page.screenshot({ path: "C:\\Cursor\\fv-1.png" });

// Try filling login form
const emailInput = await page.$('input[type="email"], input[name="email"], input[id*="email" i]');
const passInput  = await page.$('input[type="password"]');
if(emailInput && passInput){
  await emailInput.fill("matthias@rivieradininggroup.com");
  await passInput.fill("MattLondon0401!");
  await passInput.press("Enter");
  await page.waitForTimeout(5000);
  console.log("After login:", page.url());
  await page.screenshot({ path: "C:\\Cursor\\fv-2.png" });
} else {
  console.log("No login form found on:", page.url());
  console.log("Inputs:", await page.$$eval('input', els => els.map(e => e.type+'|'+e.name+'|'+e.id)));
}

await browser.close();
