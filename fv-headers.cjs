const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-full-session.json" });
  const page = await ctx.newPage();

  // Intercept REQUEST headers sent to api.fourvenues.com
  const reqHeaders = {};
  page.on("request", r => {
    if(r.url().includes("api.fourvenues.com")){
      reqHeaders[r.url().slice(0,100)] = r.headers();
    }
  });

  const apiResponses = {};
  page.on("response", async r => {
    if(r.url().includes("api.fourvenues.com")){
      try { apiResponses[r.url().slice(0,100)] = await r.text(); } catch(e){}
    }
  });

  await page.goto("https://pro.fourvenues.com/casa-neos1/reports/dashboard-sales", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log("=== Request headers to api.fourvenues.com ===");
  for(const [url, hdrs] of Object.entries(reqHeaders)){
    console.log(`\nURL: ${url}`);
    for(const [k,v] of Object.entries(hdrs)){
      if(!['accept-encoding','accept-language','user-agent','sec-'].some(x=>k.startsWith(x)))
        console.log(`  ${k}: ${v.slice(0,80)}`);
    }
  }

  // Now try using the exact same headers the page uses
  const workingUrl = Object.keys(reqHeaders).find(u => u.includes("sesiones") || u.includes("dispositivos"));
  if(workingUrl){
    const hdrs = reqHeaders[workingUrl];
    console.log("\n=== Using working headers to try events endpoints ===");
    const eventUrls = [
      "https://api.fourvenues.com/eventos/?query={}&options={\"limit\":50,\"sort\":{\"fecha\":1}}",
      "https://api.fourvenues.com/eventos_artisticos/?query={}&options={\"limit\":50}",
      "https://api.fourvenues.com/calendario/?query={}&options={\"limit\":50}",
    ];

    for(const url of eventUrls){
      const res = await page.evaluate(async ({url, hdrs}) => {
        const r = await fetch(url, { headers: hdrs }).catch(e => ({status:'err',text:async()=>e.message}));
        return { status: r.status, body: (await r.text()).slice(0,400) };
      }, {url, hdrs});
      console.log(`\n[${res.status}] ${url.slice(0,80)}`);
      console.log(res.body);
    }
  }

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-req-headers.json", JSON.stringify(reqHeaders, null, 2));
  await browser.close();
})();
