import axios from "axios";
import fs from "fs";

const TOAST_WEB_TOKEN_FILE = "C:\\Cursor\\toast-mcp-server\\toast-web-token.json";
const token = JSON.parse(fs.readFileSync(TOAST_WEB_TOKEN_FILE, "utf8")).token;

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  Referer: "https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a",
};

// Try AVA Winter Park (matches current session)
console.log("--- Testing with AVA Winter Park GUID (session restaurant) ---");
const bodyAVA = {
  renderer: "JSON",
  locations: [[{ locationGuid: "0a365c66-d2b9-42ab-8f45-94ea26d50716", locationType: "RESTAURANT" }]],
  dateRanges: { customDateRanges: [{ startDateYYYYMMDD: "20260629", endDateYYYYMMDD: "20260705" }] },
  panels: [{
    outputName: "e2a4e62f-a9a2-4389-b8c5-e15f935f2c3a",
    type: "TABLE",
    source: { type: "metrics", metrics: ["AVERAGE_ITEM_FULFILLMENT_TIME"], groupBy: ["MENU_ITEM_NAME"], filters: [], comparisons: [] }
  }],
  parameters: { customReportGuid: "348049c9-17de-45f8-8417-326b31dabf6a" }
};

const r1 = await axios.post(
  "https://www.toasttab.com/api/service/report-generator/v1/customReports/generate",
  bodyAVA, { headers, validateStatus: () => true }
);
console.log("Status:", r1.status);
console.log(JSON.stringify(r1.data, null, 2).slice(0, 2000));

// Try all venues in one request
console.log("\n--- Testing with ALL venues ---");
const bodyAll = {
  ...bodyAVA,
  locations: [[
    { locationGuid: "380f8195-ef88-495e-b144-6e3202ccc569", locationType: "RESTAURANT" },
    { locationGuid: "1c653447-0a27-4f29-8e7c-d9141a8dc66c", locationType: "RESTAURANT" },
    { locationGuid: "0a365c66-d2b9-42ab-8f45-94ea26d50716", locationType: "RESTAURANT" },
    { locationGuid: "c3f36849-5105-44ab-9168-62be1f89a59e", locationType: "RESTAURANT" },
    { locationGuid: "38e76bee-b844-427c-b078-260aa025f556", locationType: "RESTAURANT" },
    { locationGuid: "6f8b68d6-aaff-4d50-b7b9-4582a6ce8da5", locationType: "RESTAURANT" },
    { locationGuid: "618a14f3-35d0-4491-9738-92f01c9651b7", locationType: "RESTAURANT" },
  ]]
};

const r2 = await axios.post(
  "https://www.toasttab.com/api/service/report-generator/v1/customReports/generate",
  bodyAll, { headers, validateStatus: () => true }
);
console.log("Status:", r2.status);
console.log(JSON.stringify(r2.data, null, 2).slice(0, 2000));
