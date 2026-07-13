const https = require("https");

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
  // First get a MILA upcoming event ID
  const todaySec = Math.floor(Date.now() / 1000);
  const q = JSON.stringify({ negocio_id: "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM", eliminado: 0, cancelado: 0, fecha: { "$gte": todaySec } });
  const r0 = await get(`/eventos/?query=${encodeURIComponent(q)}&options=${encodeURIComponent(JSON.stringify({limit:3,sort:{fecha:1}}))}`);
  const events = JSON.parse(r0.body).data;
  console.log("Sample events:", events.map(e => `${e._id} - ${e.nombre}`).join("\n"));

  const eventId = events[0]._id;
  console.log("\nTesting reservations for event:", eventId);

  // Try different endpoints with event_id
  const eps = [
    `/reservas/?query=${encodeURIComponent(JSON.stringify({evento_id: eventId}))}&options={}`,
    `/reservas_vip/?query=${encodeURIComponent(JSON.stringify({evento_id: eventId}))}&options={}`,
    `/reservas_mesa/?query=${encodeURIComponent(JSON.stringify({evento_id: eventId}))}&options={}`,
    `/mesas_reservadas/?query=${encodeURIComponent(JSON.stringify({evento_id: eventId}))}&options={}`,
    `/reservas/?query=${encodeURIComponent(JSON.stringify({evento_id: eventId, tipo: "vip"}))}&options={}`,
  ];

  for(const ep of eps){
    const r = await get(ep);
    const preview = r.body.length > 50 ? r.body.slice(0,200) : r.body;
    console.log(`\n[${r.status}] ${ep.slice(0,70)}`);
    console.log(preview);
  }

  // Check what a full evento object looks like
  const fullEvt = events[0];
  console.log("\nFull event keys:", Object.keys(fullEvt).join(", "));
})();
