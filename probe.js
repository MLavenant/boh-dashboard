import axios from "axios";
import fs from "fs";

const session = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\toast-session.json", "utf8"));
const cookies = session.cookies.filter(c => c.domain.includes("toasttab.com")).map(c => `${c.name}=${c.value}`).join("; ");
const headers = { Cookie: cookies, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };

// Try to fetch the custom reports list page (maybe unauthenticated HTML has JS bundle refs)
const r = await axios.get("https://www.toasttab.com/restaurants/admin/reports/custom-reports", {
  headers, validateStatus: () => true, maxRedirects: 0
});
console.log("status:", r.status, "content-type:", r.headers["content-type"]?.slice(0, 60));
if (typeof r.data === "string" && r.data.length > 100) {
  // Find script bundle URLs
  const scripts = r.data.match(/src="([^"]*reports[^"]*)"/g) || [];
  scripts.forEach(s => console.log("script:", s));
  // Find API-like patterns
  const apiMatches = r.data.match(/\/api\/[^"' ]{1,80}/g) || [];
  apiMatches.slice(0, 20).forEach(m => console.log("api:", m));
}
