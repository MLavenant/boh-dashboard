/**
 * OpenTable auth via direct session token + OAuth authorize in browser.
 * 1. Get session token from Okta REST API (no browser needed)
 * 2. Load OAuth authorize URL with sessionToken in browser (auto-redirects to GuestCenter)
 * 3. Intercept Bearer token from API calls
 */
import { chromium } from "playwright";
import axios from "axios";
import fs from "fs";

const USERNAME = "matthias@rivieradininggroup.com";
const PASSWORD = "MattLondon0401!";
const CLIENT_ID = "0oabit60qvY1wTxAv5d6"; // from intercepted URL

const RESTAURANTS = {
  claudie:           1384252,
  casa_neos:         1304860,
  ava_coconut_grove: 1443061,
  ava_winter_park:   1208074,
  mila:              1054648,
  mila_omakase:      1271149,
};

// ── Step 1: Get Okta session token via REST ────────────────────────────────
console.log("Step 1: Getting Okta session token...");
let sessionToken;
try {
  const r = await axios.post("https://restauth.opentable.com/api/v1/authn", {
    username: USERNAME, password: PASSWORD,
  }, { headers: { "Content-Type": "application/json", "Accept": "application/json" }, validateStatus: () => true });
  
  console.log("Status:", r.status);
  sessionToken = r.data?.sessionToken;
  if (!sessionToken) {
    console.log("Response:", JSON.stringify(r.data).slice(0, 300));
    process.exit(1);
  }
  console.log("Got session token:", sessionToken.slice(0, 20) + "...");
} catch(e) {
  console.error("Auth error:", e.message);
  process.exit(1);
}

// ── Step 2: Load OAuth URL with session token in browser ───────────────────
const oauthUrl = `https://restauth.opentable.com/oauth2/default/v1/authorize` +
  `?client_id=${CLIENT_ID}` +
  `&redirect_uri=https://guestcenter.opentable.com/login/callback` +
  `&response_type=code` +
  `&scope=openid%20email%20profile%20ot4r%20offline_access` +
  `&access_type=offline` +
  `&sessionToken=${sessionToken}`;

console.log("\nStep 2: Loading OAuth URL in browser...");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

// Intercept Bearer tokens from API calls
let capturedToken = null;
page.on("request", req => {
  const auth = req.headers()["authorization"];
  if (auth && auth.startsWith("Bearer ")) {
    if (!capturedToken) {
      capturedToken = auth.replace("Bearer ", "");
      console.log("Bearer token captured from:", req.url().split("?")[0]);
    }
  }
});
page.on("response", async resp => {
  const url = resp.url();
  if ((url.includes("/token") || url.includes("oauth2")) && resp.status() === 200) {
    try {
      const body = await resp.json();
      if (body.access_token) {
        capturedToken = body.access_token;
        console.log("access_token captured from:", url.split("?")[0]);
      }
    } catch {}
  }
});

try {
  await page.goto(oauthUrl, { waitUntil: "networkidle", timeout: 30000 });
} catch(e) {
  console.log("Navigate error (expected if redirect):", e.message.slice(0, 100));
}
console.log("URL after OAuth:", page.url().slice(0, 100));
await page.waitForTimeout(3000);

// If redirected to GuestCenter, wait for it to load
if (page.url().includes("guestcenter.opentable.com")) {
  console.log("Landed on GuestCenter! Waiting for app to initialize...");
  await page.waitForTimeout(8000);
  
  // Navigate to reporting to trigger more API calls
  try {
    await page.goto("https://guestcenter.opentable.com/reporting/reservations-export", { timeout: 15000 });
    await page.waitForTimeout(5000);
  } catch(e) {}
}

// Get localStorage tokens
let localToken = null;
try {
  const ls = await page.evaluate(() => {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      data[k] = localStorage.getItem(k);
    }
    return data;
  });
  
  // Look for access_token in localStorage values
  for (const [k, v] of Object.entries(ls)) {
    if (v && v.includes("access_token")) {
      try {
        const parsed = JSON.parse(v);
        if (parsed.access_token) {
          localToken = parsed.access_token;
          console.log("Found access_token in localStorage key:", k);
          break;
        }
      } catch {}
    }
    if (k.includes("access") || k.includes("token") || k.includes("auth")) {
      console.log(`  LS[${k}]:`, String(v).slice(0, 100));
    }
  }
} catch(e) {
  console.log("LocalStorage error:", e.message);
}

const finalToken = capturedToken || localToken;
console.log("\nToken status:", finalToken ? "CAPTURED ✓" : "MISSING ✗");

const cookies = await context.cookies();
const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join("; ");

// Save session
const session = {
  token: finalToken,
  cookies: cookieStr,
  cookiesList: cookies,
  capturedAt: new Date().toISOString(),
};
fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\ot-session.json", JSON.stringify(session, null, 2));
console.log("Session saved to ot-session.json");

// ── Step 3: Test reservations API ─────────────────────────────────────────
if (finalToken) {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun
  const daysToLastMon = dow === 0 ? 13 : dow + 6;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysToLastMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => d.toISOString().slice(0, 10);
  const startDate = fmt(monday);
  const endDate = fmt(sunday);

  console.log(`\nStep 3: Claudie reservations ${startDate} to ${endDate}`);
  const baseUrl = "https://guestcenter.opentable.com/gateway/long-proxies/restaurant-reporting/reportingBiDatasources/api/v5/reservations/";
  const headers = {
    "Authorization": `Bearer ${finalToken}`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://guestcenter.opentable.com/",
    "Cookie": cookieStr,
  };
  
  let allItems = [];
  let offset = 0;
  const limit = 500;
  while (true) {
    const r = await axios.get(baseUrl, {
      params: { rid: RESTAURANTS.claudie, startDate, endDate, offset, limit, sort: "-visitDate", stateCategories: "seated,finished", isVisitDate: true },
      headers,
      validateStatus: () => true,
    });
    console.log(`  offset=${offset} status=${r.status}`);
    if (r.status !== 200) {
      console.log("Error:", JSON.stringify(r.data).slice(0, 300));
      break;
    }
    const data = r.data;
    const items = data?.reservations || data?.data || (Array.isArray(data) ? data : []);
    if (items.length === 0) break;
    allItems = allItems.concat(items);
    if (allItems.length === 0) {
      console.log("Keys:", Object.keys(data));
      break;
    }
    if (items.length < limit) break;
    offset += limit;
  }
  
  console.log("Total rows:", allItems.length);
  if (allItems.length > 0) {
    console.log("Columns:", Object.keys(allItems[0]));
    console.log("Sample:", JSON.stringify(allItems[0]).slice(0, 500));
    fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\ot-reservations-test.json", JSON.stringify({ total: allItems.length, reservations: allItems }, null, 2));
    console.log("Saved to ot-reservations-test.json");
  }
}

await browser.close();
console.log("\nDone.");
