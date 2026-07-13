const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-full-session.json" });
  const page = await ctx.newPage();

  let capturedHeaders = null;
  page.on("request", r => {
    if(r.url().includes("api.fourvenues.com/sesion")){
      capturedHeaders = r.headers();
    }
  });

  await page.goto("https://pro.fourvenues.com/casa-neos1/reports/dashboard-sales", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  if(!capturedHeaders){ console.log("No headers captured"); await browser.close(); return; }

  const today = new Date().toISOString().split("T")[0];
  console.log("Querying upcoming events from:", today);

  const events = await page.evaluate(async ({hdrs, today}) => {
    // Query upcoming events - eliminado=0, future dates
    const queries = [
      // All non-deleted, non-cancelled upcoming
      `{"eliminado":0,"cancelado":0,"fecha":{"$gte":"${today}"}}`,
      // Just upcoming with no filter
      `{"fecha":{"$gte":"${today}"}}`,
    ];

    const results = [];
    for(const q of queries){
      const url = `https://api.fourvenues.com/eventos/?query=${encodeURIComponent(q)}&options=${encodeURIComponent(JSON.stringify({limit:50,sort:{fecha:1}}))}`;
      const r = await fetch(url, { headers: hdrs });
      const body = await r.json().catch(()=>({}));
      results.push({ query: q, status: r.status, count: body.data?.length, data: body.data?.slice(0,20) });
    }
    return results;
  }, {hdrs: capturedHeaders, today});

  events.forEach(r => {
    console.log(`\nQuery: ${r.query}`);
    console.log(`Status: ${r.status}, Count: ${r.count}`);
    if(r.data) r.data.forEach(e => {
      const fecha = e.fecha ? new Date(e.fecha).toLocaleDateString() : 'no date';
      const artistas = e.artistas?.map(a=>a.nombre||a).join(", ") || "no artists";
      const nombre = e.nombre || e.name || "unnamed";
      console.log(`  - ${fecha} | ${nombre} | Artists: ${artistas} | active:${e.activo} cancelled:${e.cancelado} deleted:${e.eliminado}`);
    });
  });

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-upcoming-events.json", JSON.stringify(events, null, 2));
  console.log("\n✅ Saved to fv-upcoming-events.json");
  await browser.close();
})();
