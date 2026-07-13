const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false }); // must be non-headless for Cloudflare
  const sessionData = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json"));
  const ctx = await browser.newContext({ storageState: sessionData.storageState });
  const page = await ctx.newPage();

  let sessionId = null, userId = null;
  page.on("response", async r => {
    if(r.url().includes("api.fourvenues.com/sesion/") && !sessionId){
      const body = await r.text().catch(()=>"");
      try {
        const d = JSON.parse(body).data;
        if(d && d.sesion_id){ 
          sessionId = d.sesion_id; userId = d.usuario && d.usuario._id;
          console.log("✅ Got session_id:", sessionId.slice(0,20)+"...", "user:", userId && userId.slice(0,15));
        }
      } catch(e){}
    }
  });

  // This specific navigation triggered auth in previous run
  page.goto("https://pro.fourvenues.com/mila1/events", { timeout:40000 }).catch(()=>{});

  // Wait up to 20s for session
  for(let i=0; i<40; i++){
    if(sessionId) break;
    await new Promise(r=>setTimeout(r,500));
  }

  if(!sessionId){ console.log("❌ No session after 20s"); await browser.close(); return; }

  // Now query reservations with session headers
  const HDR = { 
    "storage-bucket":"pro","device-id":"Zzzwxt508tg69u21ul5d3enp3tKIcRPS",
    "accept":"application/json","content-type":"application/json",
    "app-id":"ajihln7fc0006jhmmi4lh75s2lI9O3jx",
    "session-id": sessionId, "user-id": userId || ""
  };

  const allData = {};
  const VENUES = {
    "MILA Lounge":      "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM",
    "Casa Neos BC":     "lah0f2isk8qmsg0zapu016rarffvp0xz",
    "Casa Neos Lounge": "mrph20a941lojvdykvq598p0b8j3576j",
  };
  const todaySec = Math.floor(Date.now()/1000);

  for(const [vname, vid] of Object.entries(VENUES)){
    const evR = await ctx.request.get("https://api.fourvenues.com/eventos/?query="+encodeURIComponent(JSON.stringify({negocio_id:vid,eliminado:0,cancelado:0,fecha:{"$gte":todaySec}}))+"&options="+encodeURIComponent(JSON.stringify({limit:30,sort:{fecha:1}})), {headers:HDR});
    const events = JSON.parse(await evR.text()).data || [];
    console.log("\n"+vname+": "+events.length+" events");
    allData[vname] = [];

    for(const evt of events){
      const rR = await ctx.request.get("https://api.fourvenues.com/reservas/?query="+encodeURIComponent(JSON.stringify({evento_id:evt._id}))+"&options="+encodeURIComponent(JSON.stringify({limit:200})), {headers:HDR});
      const rBody = await rR.text();
      let reservations = [];
      try { reservations = JSON.parse(rBody).data || []; } catch(e){}
      const booked = reservations.filter(r => r.estado === "aceptada" || r.status === "aceptada");
      console.log("  "+new Date(evt.fecha*1000).toLocaleDateString()+" "+evt.nombre+": "+rR.status()+" -> "+reservations.length+" total, "+booked.length+" confirmed");
      allData[vname].push({ eventId:evt._id, name:evt.nombre, date:evt.fecha, totalReservations:reservations.length, confirmed:booked.length, reservations });
    }
  }

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-live-reservations.json", JSON.stringify(allData, null, 2));
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-auth-headers.json", JSON.stringify({sessionId, userId, headers:HDR}, null, 2));
  console.log("\n✅ All reservation data saved!");
  await browser.close();
})();
