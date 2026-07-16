/**
 * Write scrape health status to Firebase so the dashboard System page can show it.
 * Usage: node fb-scrape-status.cjs <source> <ok|fail> [message] [extraJson]
 * source: fourvenues | toast
 */
const https = require("https");

const FB_DB = "rdg-dj-dashboard-default-rtdb.firebaseio.com";

function fbPut(path, payload) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: FB_DB,
      path: path + ".json",
      method: "PUT",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(r.statusCode)); });
    req.on("error", rej);
    req.write(body);
    req.end();
  });
}

(async () => {
  const source  = process.argv[2] || "unknown";
  const ok      = (process.argv[3] || "fail") === "ok";
  const message = process.argv[4] || "";
  let extra = {};
  try { if (process.argv[5]) extra = JSON.parse(process.argv[5]); } catch (_) {}

  const now = new Date();
  const payload = Object.assign({
    ok,
    message,
    at: now.toISOString(),
    atLocal: now.toLocaleString("en-US", { timeZone: "America/New_York" }),
    source
  }, extra);

  const code = await fbPut(`/rdg/scrapeStatus/${source}`, payload);
  // Also keep a rolling daily log entry
  const day = now.toISOString().slice(0, 10);
  await fbPut(`/rdg/scrapeLog/${day}/${source}`, payload);
  console.log(`[fb-scrape-status] ${source} ok=${ok} HTTP ${code}`);
  process.exit(code >= 200 && code < 300 ? 0 : 1);
})().catch(e => {
  console.error("[fb-scrape-status] ERROR", e.message);
  process.exit(1);
});
