import axios from "axios";
import fs from "fs";

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

const baseBody = {
  renderer: "JSON",
  locations: [[{ locationGuid: "0a365c66-d2b9-42ab-8f45-94ea26d50716", locationType: "RESTAURANT" }]],
  dateRanges: { customDateRanges: [{ startDateYYYYMMDD: "20260629", endDateYYYYMMDD: "20260705" }] },
  panels: [panel],
};

const attempts = [
  {
    label: "Bearer + cookies + browser customReportGuid + origin",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookies,
      Origin: "https://www.toasttab.com",
      Referer: "https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a",
    },
    body: { ...baseBody, parameters: { customReportGuid: "55a8062f-404c-448c-b162-cf5bcc27f94a" } }
  },
  {
    label: "Bearer + cookies + report UUID as customReportGuid",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookies,
      Origin: "https://www.toasttab.com",
      Referer: "https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a",
    },
    body: { ...baseBody, parameters: { customReportGuid: "348049c9-17de-45f8-8417-326b31dabf6a" } }
  },
  {
    label: "Bearer only + origin + no parameters",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://www.toasttab.com",
      Referer: "https://www.toasttab.com/restaurants/admin/reports/custom-reports/348049c9-17de-45f8-8417-326b31dabf6a",
    },
    body: { ...baseBody }
  },
];

for (const { label, headers, body } of attempts) {
  const r = await axios.post(
    "https://www.toasttab.com/api/service/report-generator/v1/customReports/generate",
    body, { headers, validateStatus: () => true }
  );
  console.log(`\n[${r.status}] ${label}`);
  if (r.status !== 200) {
    console.log("  error:", r.data?.message || JSON.stringify(r.data).slice(0, 100));
  } else {
    console.log("  SUCCESS! Response keys:", Object.keys(r.data));
    console.log("  Data:", JSON.stringify(r.data).slice(0, 1000));
  }
}
