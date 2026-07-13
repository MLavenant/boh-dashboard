const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const allCalls = [];
  page.on("response", async r => {
    if(r.url().includes("api.fourvenues.com")){
      const body = await r.text().catch(()=>"");
      allCalls.push({ url: r.url().slice(0,150), status: r.status(), body: body.slice(0,400) });
    }
  });

  // Go to login page
  await page.goto("https://pro.fourvenues.com/mila1/reports/dashboard-sales", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Wait for the FourVenues login page
  await page.waitForURL("**/authorization/**", { timeout: 15000 });
  await page.waitForTimeout(1000);
  console.log("On auth page:", page.url());

  // Enter email in the email field (not Google)
  const emailInput = await page.$('input[type="email"], input[placeholder*="mail" i], input[name*="email" i]');
  if(emailInput){
    await emailInput.fill("matthias@rivieradininggroup.com");
    console.log("✅ Email entered");
    // Click Next
    await page.click('button:has-text("Next"), [type="submit"]');
    console.log("✅ Clicked Next — check your email (Outlook) and click Continue");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "C:\\Cursor\\fv-email-sent.png" });
  } else {
    console.log("No email input found, taking screenshot");
    await page.screenshot({ path: "C:\\Cursor\\fv-no-input.png" });
  }

  // Wait for user to click Continue in email (up to 3 minutes)
  console.log("=================================================");
  console.log("Waiting for you to click Continue in your email...");
  console.log("=================================================");
  await page.waitForURL("**/pro.fourvenues.com/**reports/**", { timeout: 180000 });
  console.log("✅ Authenticated! URL:", page.url());
  await page.waitForTimeout(5000);

  // Capture session
  const state = await ctx.storageState();
  const allCookies = await ctx.cookies();
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-email-session.json", JSON.stringify({ storageState: state, allCookies }, null, 2));
  console.log("✅ Session saved. Cookies:", allCookies.length, "domains:", [...new Set(allCookies.map(c=>c.domain))].join(", "));

  // Try hitting reservations now
  const todaySec = Math.floor(Date.now() / 1000);
  const q = JSON.stringify({ negocio_id: "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM", fecha_evento: { "$gte": todaySec } });
  const res = await ctx.request.get(`https://api.fourvenues.com/reservas/?query=${encodeURIComponent(q)}&options=${encodeURIComponent(JSON.stringify({limit:20,sort:{fecha_evento:1}}))}`, {
    headers: { "storage-bucket":"pro","device-id":"Zzzwxt508tg69u21ul5d3enp3tKIcRPS","accept":"application/json","content-type":"application/json","app-id":"ajihln7fc0006jhmmi4lh75s2lI9O3jx" }
  });
  const resBody = await res.text();
  console.log("\nReservations test:", res.status(), resBody.slice(0,300));
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-reservas-test.json", resBody);

  await browser.close();
})();
