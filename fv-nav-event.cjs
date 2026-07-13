const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-session.json" });
  const page = await ctx.newPage();

  const captured = {};
  page.on("response", async r => {
    const u = r.url();
    if(u.includes("api.fourvenues.com") && !u.includes(".js") && !u.includes(".css")){
      const body = await r.text().catch(()=>"");
      if(body.length > 20) {
        captured[u.slice(0,150)] = { status: r.status(), body: body.slice(0,1000) };
        if(body.includes("reserva") || body.includes("aceptada") || body.includes("mesa"))
          console.log("🎯 RESERVATION DATA:", u.slice(0,100), body.slice(0,200));
      }
    }
  });

  // Navigate directly to MILA events management
  const urls = [
    "https://pro.fourvenues.com/mila1/events/of26x5gux3si5w13x53v9pf2byf2qspt",
    "https://pro.fourvenues.com/mila1/events/of26x5gux3si5w13x53v9pf2byf2qspt/reservations",
    "https://pro.fourvenues.com/mila1/events/of26x5gux3si5w13x53v9pf2byf2qspt/tables",
    "https://pro.fourvenues.com/mila1/events",
  ];

  for(const url of urls){
    await page.goto(url, { waitUntil:"networkidle", timeout:15000 }).catch(()=>{});
    await page.waitForTimeout(3000);
    const curUrl = page.url();
    console.log("Navigated:", curUrl.slice(0,80));
    if(!curUrl.includes("id.fourvenues") && !curUrl.includes("login")){
      await page.screenshot({ path: "C:\\Cursor\\fv-page-"+url.split("/").slice(-1)[0]+".png" });
      // Try clicking on event/reservation links
      const links = await page.$$eval("a[href], button", els => els.map(e => ({text:e.innerText?.trim().slice(0,30), href:e.href||''})).filter(e=>e.text));
      console.log("Links:", links.slice(0,8).map(l=>l.text+"->"+l.href.slice(0,50)).join(" | "));
      break;
    }
  }

  await page.waitForTimeout(3000);
  console.log("\n=== Captured API calls:", Object.keys(captured).length);
  Object.entries(captured).forEach(([u,v]) => console.log("["+v.status+"] "+u.slice(0,80)+": "+v.body.slice(0,100)));

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-event-page-data.json", JSON.stringify(captured, null, 2));
  await browser.close();
})();
