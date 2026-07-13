const https = require("https");
const fs = require("fs");

// Exact headers from the intercepted request
const HDR = {
  "referer": "https://pro.fourvenues.com/",
  "user-id": "Xmip4ribu017o017cewvjhixlVTrVIVx",
  "device-id": "Q529vp56m4h2q395ia0i6xt0csuPejE3",
  "accept": "application/json, text/plain, */*",
  "content-type": "application/json",
  "app-id": "ajihln7fc0006jhmmi4lh75s2lI9O3jx",
  "session-id": "Amrgwu1hg08ci018v999199g0DyFnYlV"
};

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = { hostname:"api.fourvenues.com", path, method:"POST", headers:{...HDR,"content-length":Buffer.byteLength(data)} };
    const req = https.request(opts, res => { let d=""; res.on("data",c=>d+=c); res.on("end",()=>resolve({status:res.statusCode,body:d})); });
    req.on("error",reject); req.write(data); req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    https.get({ hostname:"api.fourvenues.com", path, headers:HDR }, res => { let d=""; res.on("data",c=>d+=c); res.on("end",()=>resolve({status:res.statusCode,body:d})); }).on("error",reject);
  });
}

(async () => {
  const VENUES = {
    "MILA Lounge":      "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM",
    "Casa Neos BC":     "lah0f2isk8qmsg0zapu016rarffvp0xz",
    "Casa Neos Lounge": "mrph20a941lojvdykvq598p0b8j3576j",
  };
  const today = new Date().toISOString().split("T")[0];
  const end = new Date(Date.now()+90*86400000).toISOString().split("T")[0];
  const todaySec = Math.floor(Date.now()/1000);
  
  const allResults = {};

  for(const [vname, vid] of Object.entries(VENUES)){
    console.log("\n=== "+vname+" ===");

    // 1. Get upcoming events
    const evQ = JSON.stringify({negocio_id:vid,eliminado:0,cancelado:0,fecha:{"$gte":todaySec}});
    const evR = await get("/eventos/?query="+encodeURIComponent(evQ)+"&options="+encodeURIComponent(JSON.stringify({limit:30,sort:{fecha:1}})));
    const events = JSON.parse(evR.body).data || [];
    console.log(events.length+" upcoming events");

    // 2. Try reservas for each event with correct session headers
    for(const evt of events.slice(0,3)){
      const rQ = JSON.stringify({evento_id:evt._id});
      const rR = await get("/reservas/?query="+encodeURIComponent(rQ)+"&options="+encodeURIComponent(JSON.stringify({limit:100})));
      let res = [];
      try { res = JSON.parse(rR.body).data||[]; } catch(e){}
      console.log("  "+new Date(evt.fecha*1000).toLocaleDateString()+" "+evt.nombre+": ["+rR.status+"] "+res.length+" reservations");
      if(res.length>0) console.log("   Fields:", Object.keys(res[0]).join(", "));
    }

    // 3. Try sales-report with future dates
    const srBody = { organizationId:vid, saleChannelId:null, granularity:"day", includeCommission:false, includeCustomFees:false, dateRange:{date_from:today, date_until:end+" 23:59:59", timezone:"America/New_York"} };
    const sr = await post("/reports/sales-report", srBody);
    console.log("  Future sales-report: ["+sr.status+"]", sr.body.slice(0,200));

    allResults[vname] = { events, salesReport: sr.body };
  }

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-forecast-data.json", JSON.stringify(allResults, null, 2));
  console.log("\n? Saved forecast data");
})();
