const https = require("https");

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
    https.get({ hostname: "api.fourvenues.com", path, headers: HEADERS }, res => {
      let data = ""; res.on("data", d => data += d); res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

(async () => {
  // Try endpoints to find the venue
  const eps = [
    "/mis_negocios/?query={}&options={}",
    "/negocios/?query={\"slug\":\"casa-neos1\"}&options={}",
    "/negocios/?query={\"nombre\":{\"$regex\":\"casa\",\"$options\":\"i\"}}&options={\"limit\":10}",
    "/sesion/?query={}&options={\"disableCache\":true}",
    "/mis_organizaciones/?query={}&options={}",
  ];
  for(const ep of eps){
    const r = await get(ep);
    console.log(`\n[${r.status}] ${ep.slice(0,60)}`);
    console.log(r.body.slice(0,300));
  }
})();
