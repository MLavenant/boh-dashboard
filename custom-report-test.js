import fs from "fs";
import axios from "axios";

const session = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\toast-session.json","utf8"));
const cookies = session.cookies.filter(c => c.domain.includes("toasttab.com")).map(c => `${c.name}=${c.value}`).join("; ");
const headers = {
  Cookie: cookies,
  "User-Agent": "Mozilla/5.0",
  "X-Requested-With": "XMLHttpRequest",
  "Referer": "https://www.toasttab.com/restaurants/admin/reports/home",
  "Accept": "*/*",
};

const REPORT_ID = "348049c9-17de-45f8-8417-326b31dabf6a";

const urls = [
  `https://www.toasttab.com/restaurants/admin/reports/custom-reports/${REPORT_ID}?startDate=20260629&endDate=20260705&excel=true`,
  `https://www.toasttab.com/restaurants/admin/reports/custom-reports/${REPORT_ID}?reportDateRange=lastWeek&excel=true`,
  `https://www.toasttab.com/restaurantkitchenreports/customreport/${REPORT_ID}?reportDateRange=lastWeek&excel=true`,
  `https://www.toasttab.com/restaurants/admin/reports/custom-reports/${REPORT_ID}?reportDateRange=lastWeek`,
];

async function pollS3(locationUrl) {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const s3 = await axios.get(locationUrl, { validateStatus: () => true });
    console.log(`  Poll ${i+1}: status=${s3.status} data=`, JSON.stringify(s3.data).slice(0,200));
    if (s3.data && s3.data.downloadUrl) {
      const csv = await axios.get(s3.data.downloadUrl, { responseType: "arraybuffer", validateStatus: () => true });
      const text = Buffer.from(csv.data).toString("latin1");
      console.log("CSV headers:", text.split("\n")[0]);
      console.log("First row:", text.split("\n")[1]);
      return true;
    }
    if (s3.data && (s3.data.status === "ERROR" || s3.data.status === "FAILED")) {
      console.log("  S3 error:", s3.data.message);
      return false;
    }
  }
  console.log("  Timed out polling S3");
  return false;
}

for (const url of urls) {
  console.log("\n=== Testing:", url, "===");
  try {
    const res = await axios.get(url, { headers, validateStatus: () => true, maxRedirects: 0 });
    console.log("Status:", res.status);
    console.log("Content-Type:", res.headers["content-type"]);
    console.log("Location:", res.headers["location"]);
    const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    console.log("Body (300):", body.slice(0, 300));

    if (res.status === 202 && res.headers["location"]) {
      console.log(">>> Got 202 + location, polling S3...");
      const found = await pollS3(res.headers["location"]);
      if (found) break;
    }
  } catch (e) {
    console.log("ERROR:", e.message);
  }
}
