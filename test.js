import axios from "axios";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config({ path: "C:\\Cursor\\toast-mcp-server\\.env", override: true });

const session = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\toast-session.json", "utf8"));
const cookies = session.cookies.filter(c => c.domain.includes("toasttab.com")).map(c => `${c.name}=${c.value}`).join("; ");
const BASE = "https://www.toasttab.com";
const headers = {
  Cookie: cookies, "User-Agent": "Mozilla/5.0", "Accept": "*/*",
  "X-Requested-With": "XMLHttpRequest",
  "Referer": "https://www.toasttab.com/restaurants/admin/reports/home",
};

async function fetchItemDetails(groupId, dateRange = "lastWeek") {
  const url = `${BASE}/restaurants/admin/reports/menu/toplevelitemselections?excel=true&reportDateRange=${dateRange}&reportGroupIds=${groupId}&numberOfRestaurants=1`;
  const res = await axios.get(url, { headers, validateStatus: () => true });
  const s3Url = res.headers["location"];
  if (!s3Url) return { error: `HTTP ${res.status}` };
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const d = (await axios.get(s3Url, { validateStatus: () => true })).data;
    if (d.downloadUrl) {
      const csv = await axios.get(d.downloadUrl, { responseType: "arraybuffer" });
      const text = Buffer.from(csv.data).toString("latin1");
      const lines = text.split("\n").filter(l => l.trim());
      return { rows: lines.length - 1, header: lines[0], sample: lines[1], csv: text };
    }
    if (d.status === "ERROR") return { error: d.message };
  }
  return { error: "timeout" };
}

const VENUES = {
  "Claudie":           "500000037853698711",
  "AVA Coconut Grove": "500000056033936853",
  "AVA Winter Park":   "500000013674501001",
  "MM Club AVA":       "500000020877751155",
  "Casa Neos":         "500000037911188149",
  "Casa Neos Lounge":  "500000060638376351",
  "MILA Miami":        "500000000001501691",
  "MM Club MILA":      "500000020878616311",
};

let allRows = [];
let header = "";

console.log("Fetching Item Details — all venues — lastWeek:\n");
for (const [name, id] of Object.entries(VENUES)) {
  process.stdout.write(`  ${name.padEnd(20)} `);
  const r = await fetchItemDetails(id);
  if (r.error) { console.log(`ERROR: ${r.error}`); continue; }
  if (!header) header = r.header;
  const lines = r.csv.split("\n").filter(l => l.trim()).slice(1);
  allRows = allRows.concat(lines);
  console.log(`${r.rows} rows | sample: ${r.sample?.split(",").slice(0,5).join(", ")}`);
}

const combined = [header, ...allRows].join("\n");
fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\item-details-lastweek.csv", combined);
console.log(`\nTotal: ${allRows.length} rows | Header: ${header?.split(",").slice(0,8).join(", ")}...`);
console.log("Saved to item-details-lastweek.csv");
