/**
 * refresh-session.mjs
 * Headless Playwright login to Toast to refresh toast-session.json
 */
import { chromium } from "playwright";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: "C:\\Cursor\\toast-mcp-server\\.env", override: true });

const SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\toast-session.json";

async function run() {
  console.log("Launching headless browser...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to Toast login...");
  await page.goto("https://www.toasttab.com/restaurants/admin/login", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });

  // Fill email
  await page.waitForSelector('input[type="text"], input[type="email"]', { state: "visible", timeout: 20000 });
  await page.fill('input[type="text"], input[type="email"]', process.env.TOAST_EMAIL);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  // Fill password
  await page.waitForSelector('input[type="password"]', { state: "visible", timeout: 15000 });
  await page.fill('input[type="password"]', process.env.TOAST_PASSWORD);
  await page.click('button[type="submit"]');

  console.log("Waiting for login redirect (up to 60s)...");
  try {
    await page.waitForURL("**/restaurants/admin/**", { timeout: 60000 });
  } catch (e) {
    // May land on 2FA page or different URL; take screenshot to diagnose
    await page.screenshot({ path: "C:\\Cursor\\toast-mcp-server\\login-state.png" });
    console.log("Screenshot saved to login-state.png");
    const url = page.url();
    console.log("Current URL:", url);
    if (url.includes("login") || url.includes("auth") || url.includes("mfa") || url.includes("verify")) {
      console.error("Login may require 2FA or failed. Check login-state.png");
      await browser.close();
      process.exit(1);
    }
  }

  console.log("Logged in. Current URL:", page.url());

  // Navigate to kitchen report to warm up session
  await page.goto("https://www.toasttab.com/restaurants/admin/reports/home", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // Save session
  const state = await context.storageState();
  // Add capturedAt
  state.capturedAt = new Date().toISOString();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
  console.log(`Session saved to ${SESSION_FILE}`);
  console.log("Cookie count:", state.cookies.length);

  await browser.close();
  console.log("Done.");
}

run().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
