const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const sessionData = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json"));
  const ctx = await browser.newContext({ storageState: sessionData.storageState });
  const page = await ctx.newPage();

  // Capture session headers from a real request
  let capturedHeaders = null;
  page.on("request", r => {
    if(r.url().includes("api.fourvenues.com/reports/sales-report")) {
      capturedHeaders = r.headers();
    }
  });

  await page.goto("https://pro.fourvenues.com/mila1/reports/sales-overview", { waitUntil:"domcontentloaded", timeout:30000 });
  await page.waitForTimeout(7000);

  if(!capturedHeaders) { console.log("No headers captured, refreshing..."); await page.reload(); await page.waitForTimeout(5000); }
  
  if(!capturedHeaders) { console.log("FAILED to capture headers"); await browser.close(); process.exit(1); }

  console.log("Captured session-id:", capturedHeaders["session-id"]);
  console.log("Captured user-id:", capturedHeaders["user-id"]);
  console.log("Captured device-id:", capturedHeaders["device-id"]);

  // Now use page.evaluate to make API calls with full cookie+header context
  const VENUES = [
    {name:"MILA Lounge", id:"Mmgkyvi0903mo01cm3vxg0phrtTEPpSM"},
    {name:"Casa Neos BC", id:"lah0f2isk8qmsg0zapu016rarffvp0xz"},
    {name:"Casa Neos Lounge", id:"mrph20a941lojvdykvq598p0b8j3576j"},
  ];
  const today = new Date().toISOString().split("T")[0];
  const future = new Date(Date.now()+90*86400000).toISOString().split("T")[0];

  const results = {};
  for(const v of VENUES){
    // Get upcoming events (no auth needed)
    const evQ = JSON.stringify({negocio_id:v.id,eliminado:0,cancelado:0,fecha:{"$gte":Math.floor(Date.now()/1000)}});
    const evR = await page.evaluate(async(q)=>{
      const r = await fetch("https://api.fourvenues.com/eventos/?query="+encodeURIComponent(q)+"&options="+encodeURIComponent('{"limit":50,"sort":{"fecha":1}}'));
      const text = await r.text();
      try { return JSON.parse(text); } catch(e){ return {data:[], _raw:text.slice(0,200)}; }
    }, evQ);
    const events = evR.data || [];
    console.log(v.name+": "+events.length+" upcoming events, raw:", JSON.stringify(evR).slice(0,200));

    // For each event, get reservations
    const eventsWithReservations = [];
    for(const evt of events.slice(0,10)){
      const rQ = JSON.stringify({evento_id:evt._id,estado:"aceptada"});
      const rR = await page.evaluate(async([q, hdrs])=>{
        const r = await fetch("https://api.fourvenues.com/reservas/?query="+encodeURIComponent(q)+"&options="+encodeURIComponent('{"limit":200}'), {
          credentials:"include",
          headers: hdrs
        });
        return {status:r.status, body: await r.text()};
      }, [rQ, {
        "user-id": capturedHeaders["user-id"],
        "device-id": capturedHeaders["device-id"],
        "session-id": capturedHeaders["session-id"],
        "app-id": capturedHeaders["app-id"],
        "accept": "application/json, text/plain, */*",
        "referer": "https://pro.fourvenues.com/",
      }]);
      let reservations = [];
      try { reservations = JSON.parse(rR.body).data||[]; } catch(e){}
      const date = new Date(evt.fecha*1000).toLocaleDateString();
      console.log("  ["+rR.status+"] "+date+" "+evt.nombre+": "+reservations.length+" reservations");
      eventsWithReservations.push({
        id: evt._id, name: evt.nombre,
        date: new Date(evt.fecha*1000).toISOString().split("T")[0],
        reservations: reservations.length,
        reservationList: reservations,
      });
    }
    results[v.name] = eventsWithReservations;
  }

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-reservations.json", JSON.stringify(results, null, 2));
  console.log("\n✅ Done! Saved to fv-reservations.json");
  await browser.close();
})();
