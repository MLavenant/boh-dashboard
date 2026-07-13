const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  page.on("response", async r => {
    if(r.url().includes("api.fourvenues.com") && r.url().includes("sesiones")){
      const b = await r.text().catch(()=>"");
      if(b.includes("true")) console.log("✅ User session established!");
    }
  });

  await page.goto("https://pro.fourvenues.com/mila1/reports/dashboard-sales", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForURL("**/authorization/**", { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Click email field and TYPE (triggers input events, enables button)
  const emailInput = await page.$('input[type="email"], input[name*="email" i]');
  await emailInput.click();
  await emailInput.clear();
  await page.keyboard.type("matthias@rivieradininggroup.com", { delay: 80 });
  await page.waitForTimeout(1000);

  // Now button should be enabled — click it via JS if still disabled
  const enabled = await page.$eval('#button-login, button:has-text("Next")', el => !el.disabled);
  if(enabled){
    await page.click('#button-login, button:has-text("Next")');
  } else {
    // Force call the onclick function directly
    await page.evaluate(() => { if(typeof onLoginNext === 'function') onLoginNext(); });
  }
  console.log("✅ Email submitted — check Outlook for FourVenues email and click Continue");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "C:\\Cursor\\fv-waiting-email.png" });

  console.log("=================================================");
  console.log("Waiting for you to click Continue in your email...");
  console.log("=================================================");

  await page.waitForURL("**/pro.fourvenues.com/**", { timeout: 180000 });
  console.log("✅ Authenticated! URL:", page.url());
  await page.waitForTimeout(5000);

  const state = await ctx.storageState();
  const allCookies = await ctx.cookies();
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-email-session.json", JSON.stringify({ storageState: state, allCookies }, null, 2));
  console.log("✅ Session saved with", allCookies.length, "cookies");

  // Test reservations
  const todaySec = Math.floor(Date.now() / 1000);
  const q = JSON.stringify({ negocio_id: "Mmgkyvi0903mo01cm3vxg0phrtTEPpSM", fecha_evento: { "$gte": todaySec } });
  const res = await ctx.request.get(`https://api.fourvenues.com/reservas/?query=${encodeURIComponent(q)}&options=${encodeURIComponent(JSON.stringify({limit:10,sort:{fecha_evento:1}}))}`, {
    headers: { "storage-bucket":"pro","device-id":"Zzzwxt508tg69u21ul5d3enp3tKIcRPS","accept":"application/json","content-type":"application/json","app-id":"ajihln7fc0006jhmmi4lh75s2lI9O3jx" }
  });
  const body = await res.text();
  console.log("Reservations status:", res.status(), body.slice(0, 300));
  fs.writeFileSync("C:\\Cursor\\toast-mcp-server\\fv-reservas-test.json", body);
  await browser.close();
})();
