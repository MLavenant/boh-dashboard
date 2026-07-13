import { chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
dotenv.config({ path: "C:\\Cursor\\toast-mcp-server\\.env" });

const SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\toast-session.json";

export async function scrapeTicketDetails(venue, startDate, endDate) {
  const headless = fs.existsSync(SESSION_FILE);

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 100 });

  const contextOptions = headless
    ? { storageState: SESSION_FILE }
    : {};

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    // ── LOGIN ──────────────────────────────────────────────────────
    await page.goto("https://www.toasttab.com/restaurants/admin/login", {
      waitUntil: "domcontentloaded", timeout: 30000,
    });

    // Take screenshot to see initial state
    await page.screenshot({ path: "C:\\Cursor\\toast-mcp-server\\debug0.png" });
    console.log("Initial URL:", page.url());

    // If already logged in (session restored), skip login
    if (page.url().includes("/login") || page.url().includes("auth")) {
      // Auth0 flow — wait for visible email/username input
      await page.waitForSelector('input[type="text"], input[type="email"]', { state: "visible", timeout: 20000 });
      await page.screenshot({ path: "C:\\Cursor\\toast-mcp-server\\debug0b.png" });

      // Step 1: fill email
      await page.fill('input[type="text"], input[type="email"]', process.env.TOAST_EMAIL);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "C:\\Cursor\\toast-mcp-server\\debug0c.png" });

      // Step 2: fill password (Auth0 two-step)
      await page.waitForSelector('input[type="password"]', { state: "visible", timeout: 15000 });
      await page.fill('input[type="password"]', process.env.TOAST_PASSWORD);
      await page.click('button[type="submit"]');
      await page.screenshot({ path: "C:\\Cursor\\toast-mcp-server\\debug0d.png" });

      // Wait up to 90s for 2FA + redirect (user handles 2FA manually)
      console.log("Waiting for login / 2FA completion (up to 90s)...");
      await page.waitForURL(url => !url.includes("/login"), { timeout: 90000 });
      console.log("Logged in! Saving session...");

      await context.storageState({ path: SESSION_FILE });
    }

    // ── NAVIGATE TO TICKET DETAILS REPORT ─────────────────────────
    console.log("Navigating to Ticket Details report...");
    await page.goto(
      "https://www.toasttab.com/restaurants/admin/reports/home#kitchen-timing-table",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await page.waitForTimeout(4000);

    console.log("URL after nav:", page.url());
    await page.screenshot({ path: "C:\\Cursor\\toast-mcp-server\\debug1.png" });

    // ── SET DATE RANGE ────────────────────────────────────────────
    // Look for a date range picker
    const dateButtons = await page.$$('button, input[type="date"]');
    console.log("Found interactive elements:", dateButtons.length);

    // Try to find and set start/end date
    const startInput = await page.$('input[aria-label*="start" i], input[placeholder*="start" i], input[name*="start" i]');
    const endInput   = await page.$('input[aria-label*="end" i],   input[placeholder*="end" i],   input[name*="end" i]');

    if (startInput && endInput) {
      await startInput.fill(startDate);
      await endInput.fill(endDate);
      console.log("Date range set:", startDate, "→", endDate);
    } else {
      console.log("Date inputs not found by aria-label, trying other selectors...");
    }

    await page.waitForTimeout(3000);
    await page.screenshot({ path: "C:\\Cursor\\toast-mcp-server\\debug2.png" });

    // ── LOOK FOR EXPORT BUTTON ────────────────────────────────────
    const exportBtn = await page.$(
      '[aria-label*="export" i], [aria-label*="download" i], ' +
      'button:has-text("Export"), button:has-text("Download"), ' +
      '[data-testid*="export"], [data-testid*="download"]'
    );

    if (exportBtn) {
      console.log("Export button found — clicking...");
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        exportBtn.click(),
      ]);
      const csvPath = "C:\\Cursor\\toast-mcp-server\\ticket-details.csv";
      await download.saveAs(csvPath);
      console.log("Downloaded to:", csvPath);
      return { success: true, file: csvPath };
    } else {
      console.log("Export button not found. Taking full-page screenshot...");
      await page.screenshot({ path: "C:\\Cursor\\toast-mcp-server\\debug3.png", fullPage: true });
      return { success: false, message: "Export button not found. Check debug screenshots." };
    }

  } finally {
    await browser.close();
  }
}

// ── RUN ───────────────────────────────────────────────────────────
// Last week: June 23 – June 29, 2026
const result = await scrapeTicketDetails("claudie", "2026-06-23", "2026-06-29");
console.log("Result:", result);
