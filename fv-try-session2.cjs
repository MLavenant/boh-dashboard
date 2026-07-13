const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-full-session2.json" });
  const page = await ctx.newPage();

  const allCalls = [];
  page.on("request", r => {
    if(r.url().includes("api.fourvenues.com")){
      allCalls.push({ url: r.url().slice(0,200), headers: r.headers() });
    }
  });
  page.on("response", async r => {
    if(r.url().includes("api.fourvenues.com")){
      const body = await r.text().catch(()=>"");
      const c = allCalls.find(x => x.url === r.url().slice(0,200) && !x.body);
      if(c){ c.status = r.status(); c.body = body.slice(0,600); }
    }
  });

  // Navigate to MILA events list
  await page.goto("https://pro.fourvenues.com/mila1/events", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);
  console.log("URL:", page.url());

  // If we're on the events page, try clicking on an event
  if(page.url().includes("events")){
    await page.screenshot({ path: "C:\\Cursor\\fv-events-list.png" });
    // Try clicking first event
    const firstEvent = await page.$('[data-event], .event-item, table tbody tr, li[class*="event"]');
    if(firstEvent){ await firstEvent.click(); await page.waitForTimeout(3000); }
  }

  await page.screenshot({ path: "C:\\Cursor\\fv-current.png" });

  console.log("\nAll API calls:");
  allCalls.filter(c=>c.body).forEach(c => {
    console.log(`[${c.status}] ${c.url.slice(0,100)}`);
    console.log(`  headers: session-id="${c.headers['session-id']||''}" user-id="${c.headers['user-id']||''}"`);
    console.log(`  body: ${c.body.slice(0,100)}`);
  });

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-logged-calls.json", JSON.stringify(allCalls, null, 2));
  await browser.close();
})();
