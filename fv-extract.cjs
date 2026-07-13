const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-session.json" });
  const page = await ctx.newPage();

  // Capture ALL API calls with full response bodies
  const apiCalls = [];
  page.on("response", async r => {
    const u = r.url();
    if(u.includes("api.fourvenues.com") || u.includes("fourvenues.com/api")){
      try {
        const body = await r.text().catch(()=>"");
        const headers = r.headers();
        apiCalls.push({ url: u, status: r.status(), headers, body });
        console.log(`API: ${r.status()} ${u.slice(0,120)}`);
      } catch(e){}
    }
  });

  // Load the dashboard to get auth tokens in use
  await page.goto("https://pro.fourvenues.com/casa-neos1/reports/dashboard-sales", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);

  // Extract any auth tokens/headers from cookies or localStorage
  const ls = await page.evaluate(() => {
    const out = {};
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      out[k]=localStorage.getItem(k);
    }
    return out;
  });
  console.log("LocalStorage keys:", Object.keys(ls));

  const cookies = await ctx.cookies("https://pro.fourvenues.com");
  console.log("Auth cookies:", cookies.map(c=>c.name+":"+c.value.slice(0,30)).join("\n"));

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-ls.json", JSON.stringify(ls,null,2));
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-api-full.json", JSON.stringify(apiCalls,null,2));

  console.log("\nTotal API calls:", apiCalls.length);
  await browser.close();
})();
