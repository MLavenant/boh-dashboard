const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const sd = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json"));
  const ctx = await browser.newContext({ storageState: sd.storageState });
  const page = await ctx.newPage();

  const captured = {};
  page.on("response", async r => {
    if(r.url().includes("api.fourvenues.com") && r.status()===200){
      const body = await r.text().catch(()=>"");
      if(body.length > 50) captured[r.url()] = { status: r.status(), body };
    }
  });

  // First get upcoming events
  const todaySec = Math.floor(Date.now()/1000);
  const evQ = JSON.stringify({negocio_id:"Mmgkyvi0903mo01cm3vxg0phrtTEPpSM",eliminado:0,cancelado:0,fecha:{"$gte":todaySec}});
  await page.goto("https://pro.fourvenues.com/mila1/reports/sales-overview", { waitUntil:"domcontentloaded", timeout:30000 });
  await page.waitForTimeout(4000);
  
  // Fetch events directly (no auth needed)
  const evR = await ctx.request.get("https://api.fourvenues.com/eventos/?query="+encodeURIComponent(evQ)+"&options="+encodeURIComponent('{"limit":5,"sort":{"fecha":1}}'));
  const evText = await evR.text();
  let events = [];
  try { events = JSON.parse(evText).data || []; } catch(e) { console.error("Events parse error:", evText.slice(0,200)); }
  console.log("Upcoming events:", events.map(e=>e._id+" "+e.nombre).join(", "));

  // Navigate to first upcoming event's booking page
  if(events.length > 0) {
    const evt = events[0];
    console.log("\nNavigating to event booking page:", evt.nombre, evt._id);
    await page.goto(`https://pro.fourvenues.com/mila1/${evt._id}/sales/bookings`, { waitUntil:"domcontentloaded", timeout:30000 });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: "C:\\Cursor\\fv-event-bookings.png" });
    console.log("Page URL:", page.url());
    console.log("\nCaptured calls:");
    Object.keys(captured).forEach(u => {
      const d = captured[u];
      if(!u.includes("sesion") && !u.includes("notification") && !u.includes("announc")){
        console.log("  "+u.slice(30,120));
        console.log("  "+d.body.slice(0,200));
      }
    });
  }

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-event-calls.json", JSON.stringify(captured, null, 2));
  await browser.close();
})();
