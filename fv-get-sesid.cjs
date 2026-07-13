const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const sessionData = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json"));
  const ctx = await browser.newContext({ storageState: sessionData.storageState });
  const page = await ctx.newPage();

  let sessionId = null, userId = null;
  page.on("response", async r => {
    if(r.url().includes("api.fourvenues.com/sesion/") && !sessionId){
      const body = await r.text().catch(()=>"");
      try {
        const d = JSON.parse(body).data;
        if(d && d.sesion_id){ sessionId = d.sesion_id; userId = d.usuario && d.usuario._id; }
      } catch(e){}
    }
  });

  // Navigate to events page which triggered authenticated sesion in previous run
  page.goto("https://pro.fourvenues.com/mila1/events", { timeout:30000 }).catch(()=>{});
  // Wait up to 15s for session_id
  await new Promise(resolve => {
    const t = setTimeout(resolve, 15000);
    const check = setInterval(() => { if(sessionId){ clearTimeout(t); clearInterval(check); resolve(); } }, 200);
  });
  
  console.log("session_id:", sessionId ? sessionId.slice(0,20)+"..." : "NOT FOUND");

  if(!sessionId){ 
    console.log("Trying /sesion/ directly...");
    const r = await ctx.request.get("https://api.fourvenues.com/sesion/?query={}&options={\"disableCache\":true}", {
      headers: { "storage-bucket":"pro","device-id":"Zzzwxt508tg69u21ul5d3enp3tKIcRPS","accept":"application/json","content-type":"application/json","app-id":"ajihln7fc0006jhmmi4lh75s2lI9O3jx" }
    });
    const body = await r.text();
    console.log("Direct sesion call:", r.status(), body.slice(0,300));
    try { const d = JSON.parse(body).data; if(d && d.sesion_id){ sessionId = d.sesion_id; userId = d.usuario && d.usuario._id; } } catch(e){}
  }

  if(sessionId){
    console.log("✅ Got session! Testing reservations...");
    const HDR = { "storage-bucket":"pro","device-id":"Zzzwxt508tg69u21ul5d3enp3tKIcRPS","accept":"application/json","content-type":"application/json","app-id":"ajihln7fc0006jhmmi4lh75s2lI9O3jx","session-id":sessionId,"user-id":userId||"" };
    const eventId = "of26x5gux3si5w13x53v9pf2byf2qspt"; // MILA ONOMA event
    const r = await ctx.request.get("https://api.fourvenues.com/reservas/?query="+encodeURIComponent(JSON.stringify({evento_id:eventId}))+"&options="+encodeURIComponent(JSON.stringify({limit:20})), {headers:HDR});
    const body = await r.text();
    console.log("Reservations:", r.status(), body.slice(0,400));
    fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-auth-headers.json", JSON.stringify({sessionId, userId, headers:HDR},null,2));
  }

  await browser.close();
})();
