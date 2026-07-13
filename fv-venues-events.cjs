const https = require("https");
const fs = require("fs");

const HEADERS = {
  "storage-bucket": "pro",
  "referer": "https://pro.fourvenues.com/",
  "device-id": "Zzzwxt508tg69u21ul5d3enp3tKIcRPS",
  "accept": "application/json, text/plain, */*",
  "content-type": "application/json",
  "app-id": "ajihln7fc0006jhmmi4lh75s2lI9O3jx",
  "user-agent": "Mozilla/5.0"
};

function get(path) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: "api.fourvenues.com", path, headers: HEADERS }, res => {
      let data = ""; res.on("data", d => data += d); res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

(async () => {
  // Find all 3 venues
  const slugs = ["casa-neos1", "casa-neos-lounge", "mila-miami", "mila-lounge", "mila"];
  const venues = {};
  for(const slug of slugs){
    const r = await get(`/negocios/?query=${encodeURIComponent(JSON.stringify({slug}))}&options={}`);
    const d = JSON.parse(r.body);
    if(d.data?.length) {
      const v = d.data[0];
      venues[v._id] = { name: v.nombre, slug: v.slug, id: v._id };
      console.log(`Found: ${v.nombre} => ${v._id}`);
    }
  }

  // Search for MILA and Lounge
  for(const term of ["mila", "neos lounge", "neos-lounge"]){
    const q = JSON.stringify({nombre:{"$regex":term,"$options":"i"}});
    const r = await get(`/negocios/?query=${encodeURIComponent(q)}&options={\"limit\":5}`);
    const d = JSON.parse(r.body);
    d.data?.forEach(v => {
      if(!venues[v._id]) {
        venues[v._id] = { name: v.nombre, slug: v.slug, id: v._id };
        console.log(`Found via search: ${v.nombre} => ${v._id}`);
      }
    });
  }

  console.log("\n=== VENUES FOUND ===");
  Object.values(venues).forEach(v => console.log(`${v.name} (${v.slug}): ${v.id}`));

  // Get upcoming events for each venue
  const todaySec = Math.floor(Date.now() / 1000);
  const allUpcoming = {};

  for(const [vid, venue] of Object.entries(venues)){
    const q = JSON.stringify({ negocio_id: vid, eliminado: 0, cancelado: 0, fecha: { "$gte": todaySec } });
    const opts = JSON.stringify({ limit: 50, sort: { fecha: 1 } });
    const r = await get(`/eventos/?query=${encodeURIComponent(q)}&options=${encodeURIComponent(opts)}`);
    const d = JSON.parse(r.body);
    const events = d.data || [];
    allUpcoming[venue.name] = events.map(e => ({
      id: e._id,
      name: e.nombre,
      date: new Date(e.fecha * 1000).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}),
      dateRaw: e.fecha,
      timeStart: e.inicio,
      timeEnd: e.fin,
      artists: e.artistas?.map(a=>typeof a==="string"?a:(a.nombre||a._id)) || [],
      active: e.activo,
      description: e.descripcion
    }));
    console.log(`\n${venue.name}: ${events.length} upcoming events`);
    allUpcoming[venue.name].forEach(e => console.log(`  📅 ${e.date} | "${e.name}" | ${e.artists.join(", ")||"no artists"}`));
  }

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-casa-neos-events.json", JSON.stringify(allUpcoming, null, 2));
  console.log("\n✅ Saved to fv-casa-neos-events.json");
})();
