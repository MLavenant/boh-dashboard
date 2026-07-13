import axios from "axios";
import fs from "fs";
import { randomUUID } from "crypto";

const SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\toast-session.json";
const TOAST_WEB_TOKEN_FILE = "C:\\Cursor\\toast-mcp-server\\toast-web-token.json";
const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
const token = JSON.parse(fs.readFileSync(TOAST_WEB_TOKEN_FILE, "utf8")).token;

const cookies = session.cookies
  .filter(c => c.domain.includes("toasttab.com"))
  .map(c => `${c.name}=${c.value}`)
  .join("; ");

const panel = {
  outputName: "e2a4e62f-a9a2-4389-b8c5-e15f935f2c3a",
  type: "TABLE",
  source: { type: "metrics", metrics: ["AVERAGE_ITEM_FULFILLMENT_TIME"], groupBy: ["MENU_ITEM_NAME"], filters: [], comparisons: [] }
};

const attemptBody = {
  renderer: "JSON",
  locations: [[{ locationGuid: "0a365c66-d2b9-42ab-8f45-94ea26d50716", locationType: "RESTAURANT" }]],
  dateRanges: { customDateRanges: [{ startDateYYYYMMDD: "20260629", endDateYYYYMMDD: "20260705" }] },
  panels: [panel],
  parameters: { customReportGuid: randomUUID() }, // fresh UUID like the SPA does
};

const headerCombos = [
  {
    label: "Bearer+cookies+fresh-UUID+Toast-Restaurant-header",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookies,
      Origin: "https://www.toasttab.com",
      Referer: "https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a",
      "Toast-Restaurant-External-ID": "0a365c66-d2b9-42ab-8f45-94ea26d50716",
    }
  },
  {
    label: "Bearer+cookies+fresh-UUID+no restaurant header",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookies,
      Origin: "https://www.toasttab.com",
    }
  },
];

for (const { label, headers } of headerCombos) {
  const body = { ...attemptBody, parameters: { customReportGuid: randomUUID() } };
  const r = await axios.post(
    "https://www.toasttab.com/api/service/report-generator/v1/customReports/generate",
    body, { headers, validateStatus: () => true }
  );
  console.log(`\n[${r.status}] ${label}`);
  if (r.status === 200) {
    console.log("  SUCCESS! Response:", JSON.stringify(r.data).slice(0, 1500));
  } else {
    console.log("  error:", r.data?.message || JSON.stringify(r.data).slice(0, 200));
  }
}

// Also test GET endpoint with report UUID to see what format they expect
console.log("\n--- Testing GET report config ---");
const gr = await axios.get(
  "https://www.toasttab.com/api/service/report-generator/v1/customReports/348049c9-17de-45f8-8417-326b31dabf6a",
  {
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: cookies,
      Accept: "application/json",
      Origin: "https://www.toasttab.com",
    },
    validateStatus: () => true
  }
);
console.log(`GET config status: ${gr.status}`);
if (gr.status === 200) console.log("Config:", JSON.stringify(gr.data, null, 2).slice(0, 500));
else console.log("Error:", gr.data?.message);
