const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await browser.newContext({ storageState: "C:\\Cursor\\toast-mcp-server\\fv-session.json" });
  const page = await ctx.newPage();

  // Capture ALL API calls including reservations
  const allCalls = [];
  page.on("request", r => {
    if(r.url().includes("api.fourvenues.com")){
      allCalls.push({ url: r.url(), method: r.method(), headers: r.headers(), postData: r.postData() });
    }
  });
  page.on("response", async r => {
    if(r.url().includes("api.fourvenues.com")){
      const body = await r.text().catch(()=>"");
      const found = allCalls.find(c => c.url === r.url() && !c.response);
      if(found){ found.response = { status: r.status(), body: body.slice(0,500) }; }
    }
  });

  // Go to MILA events list 
  await page.goto("https://pro.fourvenues.com/mila1/events", { timeout: 30000 });
  await page.waitForTimeout(8000);
  console.log("On events page:", page.url());

  // Look for any reservation-related calls
  const resCalls = allCalls.filter(c => 
    c.url.includes("reserva") || c.url.includes("booking") || 
    (c.response?.body && (c.response.body.includes("aceptada") || c.response.body.includes("mesa")))
  );
  console.log("\n=== Reservation-related calls:", resCalls.length);
  resCalls.forEach(c => console.log(`[${c.response?.status}] ${c.url.slice(0,120)}\n  Body: ${c.response?.body?.slice(0,200)}`));

  // List all calls
  console.log("\n=== All API calls:", allCalls.length);
  allCalls.filter(c=>c.response).forEach(c => console.log(`[${c.response.status}] ${c.url.slice(0,100)}: ${c.response.body.slice(0,80)}`));

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-events-page-calls.json", JSON.stringify(allCalls, null, 2));
  await browser.close();
})();
