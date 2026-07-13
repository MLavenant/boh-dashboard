import axios from "axios";
import fs from "fs";

const SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\toast-session.json";

function getSessionCookies() {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  return session.cookies
    .filter(c => c.domain.includes("toasttab.com"))
    .map(c => `${c.name}=${c.value}`)
    .join("; ");
}

const cookies = getSessionCookies();
const headers = {
  Cookie: cookies,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "*/*",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://www.toasttab.com/restaurants/admin/reports/home",
};

// Test kitchen timing (known-working endpoint)
const kitchenRes = await axios.get(
  "https://www.toasttab.com/restaurantkitchenreports/kitchendetailstable?excel=true&reportDateRange=yesterday&numberOfRestaurants=1",
  { headers, validateStatus: () => true, maxRedirects: 0 }
);
console.log(`Kitchen timing: status=${kitchenRes.status}, location=${kitchenRes.headers["location"] || "none"}`);

// Test custom report endpoint
const customRes = await axios.get(
  "https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a?startDate=20260629&endDate=20260705&excel=true",
  { headers, validateStatus: () => true, maxRedirects: 0 }
);
console.log(`Custom report: status=${customRes.status}`);
const body = typeof customRes.data === "string" ? customRes.data.slice(0, 200) : JSON.stringify(customRes.data).slice(0, 200);
console.log(`  body: ${body}`);
