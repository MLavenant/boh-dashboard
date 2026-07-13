import { chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config({ path: "C:\\Cursor\\toast-mcp-server\\.env", override: true });

const SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\toast-session.json";
const REPORT_UUID = "348049c9-17de-45f8-8417-326b31dabf6a";

async function run() {
  const hasSession = fs.existsSync(SESSION_FILE);
  // Use system Edge for real browser fingerprint (passes Cloudflare)
  const browser = await chromium.launch({ channel: "msedge", headless: false, slowMo: 50 });
  const contextOptions = hasSession ? { storageState: SESSION_FILE } : {};
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const captured = [];

  page.on("request", req => {
    const url = req.url();
    if (url.includes("toasttab.com") && !url.match(/\.(png|css|woff|svg|ico)(\?|$)/) && !url.includes("cdn-cgi") && !url.includes("challenge")) {
      captured.push({ type: "request", method: req.method(), url, postData: req.postData() });
    }
  });

  page.on("response", async res => {
    const url = res.url();
    if (url.includes("toasttab.com") && !url.match(/\.(png|css|woff|svg|ico)(\?|$)/) && !url.includes("cdn-cgi") && !url.includes("challenge")) {
      try {
        const ct = res.headers()["content-type"] || "";
        const isText = ct.includes("json") || ct.includes("csv") || ct.includes("text/plain") || ct.includes("text/html");
        const body = isText ? (await res.text()).slice(0, 3000) : `[binary: ${ct}]`;
        captured.push({ type: "response", status: res.status(), url, body });
      } catch {}
    }
  });

  // Check if session is still valid by trying to load admin page
  console.log("Checking session validity...");
  await page.goto("https://www.toasttab.com/restaurants/admin/reports/home", {
    waitUntil: "domcontentloaded", timeout: 30000
  }).catch(() => {});
  await page.waitForTimeout(3000);

  const currentUrl = page.url();
  if (currentUrl.includes("/login") || currentUrl.includes("challenge")) {
    await page.screenshot({ path: "C:\\Cursor\\toast-mcp-server\\login-debug.png" });
    console.log("Session expired / challenge. Screenshot saved to login-debug.png");
    console.log("Please log in manually in the browser window. Waiting up to 300s (5 minutes)...");
    // Wait for successful redirect to admin area
    await page.waitForURL("**/restaurants/admin/**", { timeout: 300000 });
    await context.storageState({ path: SESSION_FILE });
    console.log("Session saved.");
  } else {
    console.log("Session valid, current URL:", currentUrl);
  }

  // Navigate to the custom report
  console.log("Navigating to custom report...");
  captured.length = 0; // Clear earlier captures
  await page.goto(
    `https://www.toasttab.com/restaurants/admin/reports/custom-reports/${REPORT_UUID}?startDate=20260629&endDate=20260705`,
    { waitUntil: "domcontentloaded", timeout: 60000 }
  ).catch(() => {});

  await page.waitForTimeout(12000); // Wait for async data loads

  // Save new session state
  await context.storageState({ path: SESSION_FILE });
  console.log("Session refreshed and saved.");

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\captured-custom.json", JSON.stringify(captured, null, 2));

  console.log("\n=== ALL CAPTURED REQUESTS ===");
  for (const c of captured) {
    if (c.type === "request") {
      console.log(`[REQ ${c.method}] ${c.url}`);
      if (c.postData) console.log("  body:", c.postData.slice(0, 300));
    }
  }

  console.log("\n=== ALL CAPTURED RESPONSES ===");
  for (const c of captured) {
    if (c.type === "response") {
      console.log(`[${c.status}] ${c.url}`);
      if (c.body && c.body.length > 10 && !c.body.startsWith("<!DOCTYPE") && !c.body.startsWith("<html")) {
        console.log("  body:", c.body.slice(0, 500));
      }
    }
  }

  await browser.close();
  console.log("\nAll captures saved to captured-custom.json");
}

run().catch(e => { console.error(e); process.exit(1); });
