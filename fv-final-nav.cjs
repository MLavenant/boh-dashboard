const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  // Use the session that actually got to the dashboard
  const sessionData = JSON.parse(fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fv-final-session.json"));
  const ctx = await browser.newContext({ storageState: sessionData.storageState });
  const page = await ctx.newPage();

  const captured = [];
  page.on("response", async r => {
    const u = r.url();
    if(u.includes("api.fourvenues.com")){
      const body = await r.text().catch(()=>"");
      captured.push({ url: u.slice(0,200), status: r.status(), body: body.slice(0,500) });
      if(r.status() !== 200 || body.includes("reserva") || body.includes("mesa") || (body.includes("data") && body.length > 50))
        console.log("["+r.status()+"]", u.slice(0,100), "->", body.slice(0,100));
    }
  });

  // Navigate to events management page
  await page.goto("https://pro.fourvenues.com/mila1/events", { waitUntil:"networkidle", timeout:30000 });
  await page.waitForTimeout(4000);
  console.log("URL:", page.url());
  await page.screenshot({ path: "C:\\Cursor\\fv-events-mgmt.png", fullPage: true });

  if(page.url().includes("mila1/events")){
    console.log("✅ On events page!");
    // Look for reservation data in the page
    const text = await page.$eval("body", el => el.innerText.slice(0,1000)).catch(()=>"");
    console.log("Page text:", text.replace(/\n/g," ").slice(0,300));
  }

  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-mgmt-calls.json", JSON.stringify(captured, null, 2));
  await browser.close();
})();
