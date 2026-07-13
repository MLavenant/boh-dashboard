import { chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config({ path: "C:\\Cursor\\toast-mcp-server\\.env", override: true });

const SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\toast-session.json";

async function run() {
  const hasSession = fs.existsSync(SESSION_FILE);
  const browser = await chromium.launch({ headless: false, slowMo: 50 });

  const contextOptions = hasSession ? { storageState: SESSION_FILE } : {};
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  // Capture ALL network requests and responses
  const captured = [];
  page.on("request", req => {
    const url = req.url();
    if (url.includes("toasttab.com") && !url.includes(".png") && !url.includes(".css") && !url.includes(".js")) {
      captured.push({ type: "request", method: req.method(), url, headers: req.headers(), postData: req.postData() });
    }
  });
  page.on("response", async res => {
    const url = res.url();
    if (url.includes("toasttab.com/api") || url.includes("ws-api") || url.includes("/era/") || url.includes("/report") || url.includes("/kitchen") || url.includes("/check")) {
      try {
        const body = await res.text();
        captured.push({ type: "response", status: res.status(), url, body: body.slice(0, 2000) });
      } catch {}
    }
  });

  // Login if no session
  if (!hasSession) {
    console.log("Logging in...");
    await page.goto("https://www.toasttab.com/restaurants/admin/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector('input[type="text"], input[type="email"]', { state: "visible", timeout: 20000 });
    await page.fill('input[type="text"], input[type="email"]', process.env.TOAST_EMAIL);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
    await page.waitForSelector('input[type="password"]', { state: "visible", timeout: 15000 });
    await page.fill('input[type="password"]', process.env.TOAST_PASSWORD);
    await page.click('button[type="submit"]');
    console.log("Waiting for login + 2FA (up to 120s)...");
    await page.waitForURL("**/restaurants/admin/**", { timeout: 120000 });
    await context.storageState({ path: SESSION_FILE });
    console.log("Session saved.");
  }

  // Navigate to Kitchen Timing report
  console.log("Navigating to Kitchen Timing report...");
  await page.goto("https://www.toasttab.com/restaurants/admin/reports/home#kitchen-timing-table", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: "C:\\Cursor\\toast-mcp-server\\report.png" });

  // Log all captured API calls
  console.log("\n=== CAPTURED API CALLS ===");
  for (const c of captured) {
    if (c.type === "response" && c.status === 200) {
      console.log(`[${c.status}] ${c.url}`);
      if (c.body?.length > 10) console.log("  body:", c.body.slice(0, 200));
    }
  }

  // Save all captures to file for analysis
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\captured.json", JSON.stringify(captured, null, 2));
  console.log("\nAll captures saved to captured.json");
  console.log("Screenshot saved to report.png");

  await browser.close();
}

run().catch(console.error);
