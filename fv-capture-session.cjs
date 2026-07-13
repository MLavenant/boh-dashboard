const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-session.json" });
  const page = await ctx.newPage();

  // Wait for sesiones to be called (user session established)
  let sessionEstablished = false;
  let userHeaders = {};
  page.on("request", r => {
    const h = r.headers();
    if(h["session-id"] && h["session-id"].length > 5) {
      userHeaders = { "session-id": h["session-id"], "user-id": h["user-id"] || "" };
      sessionEstablished = true;
      console.log("✅ Got session headers:", JSON.stringify(userHeaders));
    }
  });

  page.on("response", async r => {
    if(r.url().includes("sesiones") || r.url().includes("sesion/")){
      const body = await r.text().catch(()=>"");
      console.log("Sesion response:", body.slice(0,200));
    }
  });

  await page.goto("https://pro.fourvenues.com/mila1/reports/dashboard-sales", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);

  // Read localStorage correctly
  const ls = await page.evaluate(() => {
    const o = {};
    for(let i=0;i<localStorage.length;i++){
      const key = localStorage.key(i);
      o[key] = localStorage.getItem(key); // FIXED: use key not index
    }
    return o;
  });

  console.log("\nLocalStorage keys:", Object.keys(ls));
  for(const [k,v] of Object.entries(ls)){
    console.log(`  ${k}: ${v?.slice(0,150)}`);
  }

  // Save correct full session
  const state = await ctx.storageState();
  // Manually fix localStorage in the state
  const fullState = { ...state, localStorage: ls, userHeaders };
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-full-session2.json", JSON.stringify(fullState, null, 2));
  console.log("\n✅ Saved full session v2");

  await browser.close();
})();
