import axios from "axios";
import fs from "fs";
import { chromium } from "playwright";

const SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\toast-session.json";
const TOAST_WEB_TOKEN_FILE = "C:\\Cursor\\toast-mcp-server\\toast-web-token.json";

async function getToken() {
  // Try cached token first
  if (fs.existsSync(TOAST_WEB_TOKEN_FILE)) {
    const s = JSON.parse(fs.readFileSync(TOAST_WEB_TOKEN_FILE, "utf8"));
    const ageMins = (Date.now() - new Date(s.capturedAt).getTime()) / 60000;
    if (ageMins < 50 && s.token) { console.log("Using cached token (age:", ageMins.toFixed(1), "min)"); return s.token; }
  }

  console.log("Capturing fresh token via Edge...");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();
  let capturedToken = null;
  context.on("response", async resp => {
    if (resp.url().includes("auth.toasttab.com/oauth/token") && resp.status() === 200) {
      try { const b = await resp.json(); if (b.access_token) capturedToken = b.access_token; } catch {}
    }
  });
  await page.goto("https://www.toasttab.com/restaurants/admin/reports/home", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(8000);
  await context.storageState({ path: SESSION_FILE });
  await browser.close();

  if (!capturedToken) throw new Error("No token captured. Session may be expired.");
  const record = { token: capturedToken, capturedAt: new Date().toISOString() };
  fs.writeFileSync(TOAST_WEB_TOKEN_FILE, JSON.stringify(record, null, 2));
  console.log("Token captured and saved.");
  return capturedToken;
}

const token = await getToken();
console.log("Token obtained, testing generate endpoint...");

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  Referer: "https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a",
};

const body = {
  renderer: "JSON",
  locations: [[
    { locationGuid: "380f8195-ef88-495e-b144-6e3202ccc569", locationType: "RESTAURANT" }, // Claudie
  ]],
  dateRanges: { customDateRanges: [{ startDateYYYYMMDD: "20260629", endDateYYYYMMDD: "20260705" }] },
  panels: [
    {
      outputName: "e2a4e62f-a9a2-4389-b8c5-e15f935f2c3a",
      type: "TABLE",
      source: { type: "metrics", metrics: ["AVERAGE_ITEM_FULFILLMENT_TIME"], groupBy: ["MENU_ITEM_NAME"], filters: [], comparisons: [] }
    }
  ],
  parameters: { customReportGuid: "348049c9-17de-45f8-8417-326b31dabf6a" }
};

const res = await axios.post(
  "https://www.toasttab.com/api/service/report-generator/v1/customReports/generate",
  body, { headers, validateStatus: () => true }
);

console.log("Status:", res.status);
console.log("Response:");
console.log(JSON.stringify(res.data, null, 2).slice(0, 3000));
