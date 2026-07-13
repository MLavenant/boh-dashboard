/**
 * Test OpenTable auth + reservations API
 */
import axios from "axios";
import fs from "fs";

const USERNAME = "matthias@rivieradininggroup.com";
const PASSWORD = "Mattgsi56920!";
const CLIENT_ID = "0oebit60qvY1wTxAv5d6";

const RESTAURANTS = {
  claudie:          1384252,
  casa_neos:        1304860,
  ava_coconut_grove: 1443061,
  ava_winter_park:  1208074,
  mila:             1054648,
  mila_omakase:     1271149,
};

// ── Step 1: Get session token ──────────────────────────────────────────────
console.log("Step 1: Getting session token...");
let sessionToken;
try {
  const r1 = await axios.post("https://restauth.opentable.com/api/v1/authn", {
    username: USERNAME,
    password: PASSWORD,
  }, { headers: { "Content-Type": "application/json" }, validateStatus: () => true });
  console.log("Status:", r1.status);
  console.log("Response keys:", Object.keys(r1.data || {}));
  sessionToken = r1.data?.sessionToken;
  if (!sessionToken && r1.data?.status === "MFA_ENROLL") {
    console.log("MFA required - checking for session token in different field...");
    sessionToken = r1.data?._embedded?.user?.sessionToken || r1.data?.stateToken;
  }
  console.log("Session token:", sessionToken ? sessionToken.slice(0, 20) + "..." : "NOT FOUND");
  console.log("Full response:", JSON.stringify(r1.data).slice(0, 500));
} catch(e) {
  console.log("Auth error:", e.message);
  process.exit(1);
}

if (!sessionToken) {
  console.log("No session token, trying password fallback...");
  try {
    const r1b = await axios.post("https://restauth.opentable.com/api/v1/authn", {
      username: USERNAME,
      password: "MattLondon0401!",
    }, { headers: { "Content-Type": "application/json" }, validateStatus: () => true });
    sessionToken = r1b.data?.sessionToken;
    console.log("Fallback token:", sessionToken ? sessionToken.slice(0, 20) + "..." : "NONE");
    console.log("Fallback response:", JSON.stringify(r1b.data).slice(0, 300));
  } catch(e) {
    console.log("Fallback error:", e.message);
  }
}

if (!sessionToken) process.exit(1);

// ── Step 2: Exchange for OAuth cookies ────────────────────────────────────
console.log("\nStep 2: OAuth authorize...");
const authUrl = `https://restauth.opentable.com/oauth2/default/v1/authorize` +
  `?client_id=${CLIENT_ID}` +
  `&redirect_uri=https://guestcenter.opentable.com/login/callback` +
  `&response_type=code` +
  `&scope=openid%20profile%20email` +
  `&sessionToken=${sessionToken}`;

let cookies = "";
try {
  const r2 = await axios.get(authUrl, {
    maxRedirects: 10,
    validateStatus: () => true,
    withCredentials: true,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  console.log("OAuth status:", r2.status);
  console.log("Final URL:", r2.request?.res?.responseUrl || r2.headers?.location || "unknown");
  // Collect cookies from all redirects
  const setCookies = r2.headers["set-cookie"] || [];
  cookies = setCookies.map(c => c.split(";")[0]).join("; ");
  console.log("Cookies:", cookies.slice(0, 200));
} catch(e) {
  console.log("OAuth error:", e.message, e.response?.status);
}

// ── Step 3: Test reservations endpoint ────────────────────────────────────
// Compute last week date range
const now = new Date();
const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
const monday = new Date(now);
monday.setDate(now.getDate() - dayOfWeek - 6); // last Monday
const sunday = new Date(monday);
sunday.setDate(monday.getDate() + 6);

const fmt = d => d.toISOString().slice(0, 10);
const startDate = fmt(monday);
const endDate = fmt(sunday);
console.log(`\nStep 3: Fetching Claudie reservations ${startDate} to ${endDate}...`);

try {
  const r3 = await axios.get(
    `https://guestcenter.opentable.com/gateway/long-proxies/restaurant-reporting/reportingBiDatasources/api/v5/reservations/`,
    {
      params: {
        rid: RESTAURANTS.claudie,
        startDate, endDate,
        offset: 0, limit: 500,
        sort: "-visitDate",
        stateCategories: "seated,finished",
        isVisitDate: true,
      },
      headers: {
        Cookie: cookies,
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "Referer": "https://guestcenter.opentable.com/",
      },
      validateStatus: () => true,
    }
  );
  console.log("Reservations status:", r3.status);
  const data = r3.data;
  if (typeof data === "object") {
    console.log("Keys:", Object.keys(data));
    const items = data.reservations || data.items || data.data || [];
    console.log("Count:", items.length || data.totalCount || "unknown");
    if (items.length > 0) {
      console.log("Sample row:", JSON.stringify(items[0]).slice(0, 300));
    }
  } else {
    console.log("Response (first 500):", String(data).slice(0, 500));
  }
  
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\ot-test-response.json", JSON.stringify({ status: r3.status, data: r3.data }, null, 2));
  console.log("Full response saved to ot-test-response.json");
} catch(e) {
  console.log("Reservations error:", e.message);
}
