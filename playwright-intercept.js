// Must set before playwright loads - use env var at launch instead
import { chromium } from "playwright";
import fs from "fs";

const session = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\toast-session.json","utf8"));
const toastCookies = session.cookies.filter(c => c.domain.includes("toasttab.com"));

const REPORT_URL = "https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a?startDate=20260629&endDate=20260705";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

// Load cookies
await context.addCookies(toastCookies.map(c => ({
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path || "/",
  secure: c.secure || false,
  httpOnly: c.httpOnly || false,
})));

const interestingRequests = [];

context.on("request", req => {
  const url = req.url();
  if (/custom|report|download|excel|fulfillment/i.test(url)) {
    console.log("REQUEST:", req.method(), url);
    console.log("  Headers:", JSON.stringify(req.headers()).slice(0,500));
    interestingRequests.push({ method: req.method(), url, headers: req.headers() });
  }
});

context.on("response", async res => {
  const url = res.url();
  if (/custom|report|download|excel|fulfillment/i.test(url)) {
    console.log("RESPONSE:", res.status(), url);
    try {
      const body = await res.text();
      console.log("  Body:", body.slice(0, 400));
    } catch {}
  }
});

const page = await context.newPage();
console.log("Navigating to report...");
await page.goto(REPORT_URL, { waitUntil: "networkidle", timeout: 30000 }).catch(e => console.log("nav error:", e.message));

// Wait a bit more for any async XHR
await page.waitForTimeout(5000);

console.log("\n=== All interesting requests captured ===");
console.log(JSON.stringify(interestingRequests, null, 2));

await browser.close();
