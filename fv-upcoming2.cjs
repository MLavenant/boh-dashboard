const https = require("https");
const fs = require("fs");

const HEADERS = {
  "storage-bucket": "pro",
  "referer": "https://pro.fourvenues.com/",
  "device-id": "Zzzwxt508tg69u21ul5d3enp3tKIcRPS",
  "accept": "application/json, text/plain, */*",
  "content-type": "application/json",
  "app-id": "ajihln7fc0006jhmmi4lh75s2lI9O3jx",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
};

function get(path) {
  return new Promise((resolve, reject) => {
    const options = { hostname: "api.fourvenues.com", path, headers: HEADERS };
    https.get(options, res => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

(async () => {
  const todaySec = Math.floor(Date.now() / 1000);
  console.log("Today (seconds):", todaySec, "=", new Date().toISOString());

  const q = JSON.stringify({ eliminado: 0, cancelado: 0, fecha: { "$gte": todaySec } });
  const opts = JSON.stringify({ limit: 50, sort: { fecha: 1 } });
  const path = `/eventos/?query=${encodeURIComponent(q)}&options=${encodeURIComponent(opts)}`;

  const r = await get(path);
  console.log("Status:", r.status);

  const data = JSON.parse(r.body);
  const events = data.data || [];
  console.log("Upcoming events count:", events.length);
  console.log("\n=== UPCOMING EVENTS ===");
  events.forEach(e => {
    const date = new Date(e.fecha * 1000).toLocaleDateString("en-US", {weekday:"short",month:"short",day:"numeric",year:"numeric"});
    const timeStart = e.inicio ? `${Math.floor(e.inicio/100)}:${String(e.inicio%100).padStart(2,'0')}` : "";
    const artists = e.artistas?.map(a=>typeof a==="string"?a:(a.nombre||a.name||a._id)).join(", ") || "TBD";
    console.log(`📅 ${date} ${timeStart} | "${e.nombre||e._id}" | ${artists} | active:${e.activo}`);
  });

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-upcoming-final.json", JSON.stringify(events, null, 2));
  console.log("\n✅ Saved to fv-upcoming-final.json");
})();
