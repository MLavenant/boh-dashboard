const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-session.json" });
  const page = await ctx.newPage();

  // Load page to get fresh JWT
  const apiCalls = [];
  page.on("response", async r => {
    if(r.url().includes("api.fourvenues.com")){
      const body = await r.text().catch(()=>"");
      if(body && body.length > 20) apiCalls.push({ url: r.url(), body });
    }
  });

  await page.goto("https://pro.fourvenues.com/casa-neos1/reports/dashboard-sales", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Get fresh JWT from localStorage
  const ls = await page.evaluate(() => {
    const out = {};
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      out[k]=localStorage.getItem(k);
    }
    return out;
  });

  // Find JWT token
  let jwt = null;
  for(const [k,v] of Object.entries(ls)){
    try {
      const parsed = JSON.parse(v);
      for(const [k2,v2] of Object.entries(parsed)){
        if(typeof v2 === "string" && v2.startsWith("eyJ")){
          jwt = v2; console.log("JWT found, key:", k2);
        }
      }
    } catch(e){}
  }

  if(!jwt){ console.log("No JWT found"); await browser.close(); return; }

  // Decode JWT payload
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString());
  console.log("JWT payload:", JSON.stringify(payload));
  console.log("Expires:", new Date(payload.exp * 1000).toISOString());

  // Try various events/bookings endpoints
  const cookies = await ctx.cookies("https://pro.fourvenues.com");
  const cookieStr = cookies.map(c=>`${c.name}=${c.value}`).join("; ");

  const today = new Date().toISOString().split("T")[0];
  const endpoints = [
    `https://api.fourvenues.com/eventos/?query={"fecha_gte":"${today}"}&options={"limit":50}`,
    `https://api.fourvenues.com/events/?query={"date_gte":"${today}"}&options={"limit":50}`,
    `https://api.fourvenues.com/reservas/?query={"fecha_gte":"${today}"}&options={"limit":50}`,
    `https://api.fourvenues.com/bookings/?query={"date_gte":"${today}"}&options={"limit":50}`,
  ];

  for(const ep of endpoints){
    const res = await page.evaluate(async ([url, token, cookie]) => {
      const r = await fetch(url, {
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
      });
      return { status: r.status, body: await r.text() };
    }, [ep, jwt, cookieStr]);
    console.log(`\n${ep.slice(0,80)}`);
    console.log(`Status: ${res.status}, Body: ${res.body.slice(0,200)}`);
  }

  await browser.close();
})();
