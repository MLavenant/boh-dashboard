const https = require("https");
const fs = require("fs");

// Headers captured from working session
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
  const todayMs = Date.now();
  
  // Get all events, no date filter (fetch all and filter client side)
  const q = JSON.stringify({ eliminado: 0, cancelado: 0 });
  const opts = JSON.stringify({ limit: 100, sort: { fecha: 1 } });
  const path = `/eventos/?query=${encodeURIComponent(q)}&options=${encodeURIComponent(opts)}`;
  
  console.log("Calling:", path.slice(0,80));
  const r = await get(path);
  console.log("Status:", r.status);
  
  if(r.status === 200){
    const data = JSON.parse(r.body);
    const events = data.data || [];
    console.log("Total events:", events.length);
    
    // Filter upcoming (fecha > today)
    const upcoming = events.filter(e => {
      const f = e.fecha;
      if(!f) return false;
      // fecha might be ms timestamp or date string
      const d = typeof f === "number" ? f : new Date(f).getTime();
      return d >= todayMs;
    });
    
    console.log("\n=== UPCOMING EVENTS ===");
    upcoming.forEach(e => {
      const date = typeof e.fecha === "number" ? new Date(e.fecha).toLocaleDateString() : e.fecha;
      const artists = e.artistas?.map(a=>a.nombre||a.name||JSON.stringify(a)).join(", ") || "TBD";
      console.log(`${date} | ${e.nombre||e.name||e._id} | Artists: ${artists}`);
    });
    
    console.log("\nSample event fields:", Object.keys(events[0]||{}).join(", "));
    fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-upcoming-events.json", JSON.stringify({ all: events, upcoming }, null, 2));
  } else {
    console.log("Error body:", r.body.slice(0,200));
    // Try without auth to understand the error
    const r2 = await get("/eventos/?query={}&options={\"limit\":5}");
    console.log("Without filter:", r2.status, r2.body.slice(0,200));
  }
})();
