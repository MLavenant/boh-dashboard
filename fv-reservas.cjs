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

const VENUES = {
  "Casa Neos Beach Club": "lah0f2isk8qmsg0zapu016rarffvp0xz",
  "Casa Neos Lounge":     "mrph20a941lojvdykvq598p0b8j3576j",
  "MILA Lounge":          "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM",
};

function get(path) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: "api.fourvenues.com", path, headers: HEADERS }, res => {
      let data = ""; res.on("data", d => data += d); res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

(async () => {
  const todaySec = Math.floor(Date.now() / 1000);
  const endSec = todaySec + 90 * 86400;

  // Try reservations endpoints
  const testEps = [
    "/reservas/?query={}&options={\"limit\":5}",
    "/reservations/?query={}&options={\"limit\":5}",
    "/bookings/?query={}&options={\"limit\":5}",
    "/mesas/?query={}&options={\"limit\":5}",
    "/tablebookings/?query={}&options={\"limit\":5}",
  ];

  console.log("=== Testing reservation endpoints ===");
  for(const ep of testEps){
    const r = await get(ep);
    console.log(`[${r.status}] ${ep.slice(0,50)}: ${r.body.slice(0,120)}`);
  }

  // Also try with venue ID filter
  const venueId = "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM"; // MILA
  const r2 = await get(`/reservas/?query=${encodeURIComponent(JSON.stringify({negocio_id: venueId}))}&options=${encodeURIComponent(JSON.stringify({limit:5,sort:{fecha_evento:1}}))}`);
  console.log(`\nWith MILA venue filter: [${r2.status}] ${r2.body.slice(0,300)}`);
})();
