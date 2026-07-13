/**
 * intercept-kitchen.mjs
 * Use Playwright to intercept the actual network calls for kitchen timing CSV export.
 */
import { chromium } from "playwright";
import fs from "fs";

const SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\toast-session.json";
const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
const toastCookies = session.cookies.filter(c => c.domain && c.domain.includes("toasttab.com"));

const GROUP_ID = "500000037853698711"; // claudie

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

await context.addCookies(toastCookies.map(c => ({
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path || "/",
  secure: c.secure || false,
  httpOnly: c.httpOnly || false,
})));

const captured = [];

context.on("request", req => {
  const url = req.url();
  if (/kitchen|report|download|excel|s3|amazonaws/i.test(url)) {
    console.log("REQ:", req.method(), url.slice(0, 150));
  }
});

context.on("response", async res => {
  const url = res.url();
  if (/kitchen|report|download|excel|s3|amazonaws/i.test(url)) {
    let body = "";
    try { body = await res.text(); } catch {}
    console.log(`RES: ${res.status()} ${url.slice(0, 150)}`);
    if (body && body.length > 2 && body.length < 2000) console.log("  body:", body.slice(0, 400));
    captured.push({ status: res.status(), url, body: body.slice(0, 1000) });
  }
});

const page = await context.newPage();

// Trigger the export via axios-style XHR through the page's fetch
console.log("\n=== Triggering kitchen timing export via page.evaluate ===");

const result = await page.evaluate(async ({ groupId }) => {
  const qs = `excel=true&reportDateRange=lastWeek&numberOfRestaurants=1&reportGroupIds=${groupId}`;
  const resp = await fetch(`https://www.toasttab.com/restaurantkitchenreports/kitchendetailstable?${qs}`, {
    method: "GET",
    headers: {
      "Accept": "*/*",
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "manual",
  });
  return {
    status: resp.status,
    headers: Object.fromEntries(resp.headers.entries()),
    bodyText: await resp.text().catch(() => ""),
  };
}, { groupId: GROUP_ID });

console.log("Trigger response:");
console.log("  status:", result.status);
console.log("  headers:", JSON.stringify(result.headers));
console.log("  body:", result.bodyText.slice(0, 500));

// Also try direct XHR
console.log("\n=== Also trying via page navigation ===");
await page.goto(
  `https://www.toasttab.com/restaurantkitchenreports/kitchendetailstable?excel=true&reportDateRange=lastWeek&numberOfRestaurants=1&reportGroupIds=${GROUP_ID}`,
  { waitUntil: "networkidle", timeout: 15000 }
).catch(e => console.log("nav error:", e.message));

await page.waitForTimeout(5000);

fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\kitchen-intercept.json", JSON.stringify(captured, null, 2));
console.log(`\nCaptured ${captured.length} requests. Saved to kitchen-intercept.json`);

await browser.close();
