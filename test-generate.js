import axios from "axios";
import fs from "fs";

const SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\toast-session.json";
const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));

// Check if session has localStorage with access token
const origins = session.origins || [];
let accessToken = null;
for (const origin of origins) {
  for (const item of (origin.localStorage || [])) {
    if (item.name && item.name.toLowerCase().includes("token")) {
      console.log("localStorage token key:", item.name, "value[:50]:", item.value?.slice(0, 50));
      if (!accessToken) accessToken = item.value;
    }
    if (item.name && item.name.toLowerCase().includes("access")) {
      console.log("localStorage access key:", item.name, "value[:50]:", item.value?.slice(0, 50));
    }
  }
}

const cookies = session.cookies
  .filter(c => c.domain.includes("toasttab.com"))
  .map(c => `${c.name}=${c.value}`)
  .join("; ");

console.log("Cookie count:", session.cookies.filter(c => c.domain.includes("toasttab.com")).length);
console.log("Cookie names:", session.cookies.filter(c => c.domain.includes("toasttab.com")).map(c => c.name).join(", "));

// Try the generate endpoint with just cookies first
const body = {
  renderer: "JSON",
  locations: [[{ locationGuid: "0a365c66-d2b9-42ab-8f45-94ea26d50716", locationType: "RESTAURANT" }]],
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

const headers = {
  Cookie: cookies,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
  Referer: "https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a",
};

console.log("\n--- Testing with cookies only ---");
const res1 = await axios.post(
  "https://www.toasttab.com/api/service/report-generator/v1/customReports/generate",
  body, { headers, validateStatus: () => true }
);
console.log("Status:", res1.status);
console.log("Body:", JSON.stringify(res1.data).slice(0, 500));
