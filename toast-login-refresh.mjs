/**
 * Interactive Toast Web Admin login → toast-session.json
 * Uses Edge (headed). Complete Cloudflare + 2FA in the window if prompted.
 */
import { chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const SESSION_FILE = path.join(__dirname, 'toast-session.json');
const ALSO_COPY = [
  path.join(__dirname, 'toast-session.json'),
  'C:\\Cursor\\toast-mcp-server\\toast-session.json',
];

async function main() {
  const email = process.env.TOAST_EMAIL;
  const password = process.env.TOAST_PASSWORD;
  if (!email || !password) throw new Error("TOAST_EMAIL / TOAST_PASSWORD missing in .env");

  console.log("Launching Edge (headed). Complete Cloudflare / 2FA if asked…");
  const browser = await chromium.launch({ channel: "msedge", headless: false, slowMo: 40 });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://www.toasttab.com/restaurants/admin/login", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });

  // Wait out Cloudflare challenge if present
  for (let i = 0; i < 40; i++) {
    const title = await page.title().catch(() => "");
    const url = page.url();
    if (/security verification|just a moment|cloudflare/i.test(title)) {
      console.log(`[${i}] Cloudflare challenge… title=${title}`);
      await page.waitForTimeout(3000);
      continue;
    }
    if (url.includes("/login") || url.includes("/admin")) break;
    await page.waitForTimeout(1500);
  }

  // If already logged in (SSO cookie), skip form
  if (!page.url().includes("/login")) {
    console.log("Already past login:", page.url());
  } else {
    await page.waitForSelector('input[type="text"], input[type="email"]', { state: "visible", timeout: 60000 });
    await page.fill('input[type="text"], input[type="email"]', email);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);
    await page.waitForSelector('input[type="password"]', { state: "visible", timeout: 30000 });
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    console.log("Waiting for admin home / 2FA (up to 3 min)…");
  }

  await page.waitForURL(/\/restaurants\/admin\//, { timeout: 180000 });
  await page.waitForTimeout(2000);

  // Confirm reports page
  await page.goto("https://www.toasttab.com/restaurants/admin/reports/home", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(4000);
  if (page.url().includes("/login")) throw new Error("Still on login after navigation");

  await context.storageState({ path: SESSION_FILE });
  for (const dest of ALSO_COPY) {
    if (path.resolve(dest) === path.resolve(SESSION_FILE)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(SESSION_FILE, dest);
  }
  console.log("Saved session →", SESSION_FILE);
  await page.screenshot({ path: "C:\\Cursor\\toast-mcp-server\\toast-login-ok.png", fullPage: true });
  await browser.close();
  console.log("Done.");
}

main().catch((e) => {
  console.error("LOGIN FAILED:", e.message);
  process.exit(1);
});
