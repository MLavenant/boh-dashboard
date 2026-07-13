const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const sessionData = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json"));
  const ctx = await browser.newContext({ storageState: sessionData.storageState });
  const page = await ctx.newPage();

  // Wait for page to fully authenticate (sesion returns user data)
  let authenticated = false;
  page.on("response", async r => {
    if(r.url().includes("api.fourvenues.com/sesion/") && !authenticated){
      const b = await r.text().catch(()=>"");
      if(b.includes("sesion_id")) authenticated = true;
    }
  });

  page.goto("https://pro.fourvenues.com/mila1/events", { timeout:40000 }).catch(()=>{});
  for(let i=0;i<30;i++){ if(authenticated) break; await new Promise(r=>setTimeout(r,500)); }
  await new Promise(r=>setTimeout(r,2000)); // Let page fully settle
  console.log("Auth:", authenticated);

  if(!authenticated){ await browser.close(); return; }

  // Use page.evaluate to make authenticated fetch calls from within the page context
  const eventId = "of26x5gux3si5w13x53v9pf2byf2qspt"; // MILA ONOMA
  const result = await page.evaluate(async (eventId) => {
    const HDR = { "accept":"application/json","content-type":"application/json" };
    // Try without any custom headers first - let browser send its own cookies
    const r = await fetch("https://api.fourvenues.com/reservas/?query="+encodeURIComponent(JSON.stringify({evento_id:eventId}))+"&options="+encodeURIComponent(JSON.stringify({limit:20})), 
      { headers: HDR, credentials: "include" }
    ).catch(e => ({ ok:false, error: e.message }));
    if(!r.ok && r.error) return { error: r.error };
    const status = r.status;
    const body = await r.text().catch(()=>"");
    return { status, body: body.slice(0,500) };
  }, eventId);

  console.log("Result from page.evaluate:", JSON.stringify(result));
  await browser.close();
})();
