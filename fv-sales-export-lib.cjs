/**
 * FourVenues Sales Export puller
 * Path (exact): Sales → sales-overview → Events → Upcoming → Select all → Apply
 *               → ⋮ (next to Compare events) → Export to Excel
 * Metric: sum "Base price (reservations)" where Status is accepted OR not-completed
 * URL: https://pro.fourvenues.com/{slug}/reports/sales-overview
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SESSION_PATH = process.env.FV_SESSION || 'C:\\Cursor\\toast-mcp-server\\fv-final-session.json';
const OUT_DIR = process.env.FV_OUT_DIR || 'C:\\Cursor\\toast-mcp-server\\fv-exports';

const VENUES = [
  { key: 'casa_neos_bc', name: 'Casa Neos Beach Club', slug: 'casa-neos1', id: 'lah0f2isk8qmsg0zapu016rarffvp0xz' },
  { key: 'mila_lounge', name: 'MILA Lounge', slug: 'mila1', id: 'Mmgkyvi0903mo01cm3vxg0phrtTEPpSM' },
  { key: 'casa_neos_lounge', name: 'Casa Neos Lounge', slug: 'casa-neos-lounge', id: 'mrph20a941lojvdykvq598p0b8j3576j' },
];

function log(msg) {
  process.stderr.write(`[${new Date().toLocaleTimeString('en-US', { hour12: false })}] ${msg}\n`);
}

function parseEventDate(raw) {
  // Export uses DD/MM/YYYY
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0'), mm = m[2].padStart(2, '0'), yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function isCountableStatus(status) {
  const e = String(status || '').toLowerCase().trim().replace(/_/g, '-');
  return e === 'accepted' || e === 'aceptada' ||
    e === 'not-completed' || e === 'not completed' ||
    e === 'no-completada' || e === 'no completada';
}

/** Parse a Sales .xls/.xlsx export into per-event Base price totals.
 *  Emailed Overview exports are multi-sheet: Ticket / Booking / Guest list / Passes.
 *  Forecast uses the Booking sheet + Base price paid (USD) (or legacy Base price (reservations)).
 */
function parseSalesExportFile(filePath) {
  const wb = XLSX.readFile(filePath);
  const prefer = ['Booking', 'Bookings', 'booking'];
  let sheetName = wb.SheetNames.find(n => prefer.includes(n))
    || wb.SheetNames.find(n => /book/i.test(n))
    || wb.SheetNames[0];
  let rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  if (!rows.length) {
    // Fall back: first non-empty sheet
    for (const n of wb.SheetNames) {
      const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' });
      if (r.length) { sheetName = n; rows = r; break; }
    }
  }
  if (!rows.length) return { rows: [], byEvent: [], filePath, sheetName };

  const normKey = (k) => String(k).toLowerCase().replace(/\s+/g, ' ').trim();
  const sample = rows[0];
  const keys = Object.keys(sample);
  const findCol = (...cands) => keys.find(k => cands.some(c => normKey(k).includes(c)));

  const colEvent = findCol("event's name", 'event name', 'event');
  const colDate = findCol('event date');
  const colStatus = findCol('status');
  // Overview email export: "Base price paid (USD)"; older .xls: "Base price (reservations)"
  const colBase = findCol('base price paid', 'base price (reservations)', 'base price');
  const colSpace = findCol('space (reservations)', 'space');
  const colName = findCol('name');
  const colPartner = findCol('partner', 'assigned pr');

  if (!colEvent || !colBase || !colStatus) {
    throw new Error('Sales export missing required columns (Event / Status / Base price). Sheet=' + sheetName + ' Got: ' + keys.join(', '));
  }

  const detail = [];
  for (const r of rows) {
    const status = r[colStatus];
    if (!isCountableStatus(status)) continue;
    const base = Number(r[colBase]) || 0;
    const event = String(r[colEvent] || '').trim();
    const date = parseEventDate(r[colDate]);
    detail.push({
      event, date, status: String(status).toLowerCase(),
      basePrice: base,
      space: colSpace ? r[colSpace] : '',
      guest: colName ? r[colName] : '',
      partner: colPartner ? String(r[colPartner] || '').trim() : ''
    });
  }

  const map = new Map();
  for (const d of detail) {
    const key = `${d.event}|${d.date || ''}`;
    if (!map.has(key)) map.set(key, { event: d.event, date: d.date, basePrice: 0, bookings: 0, rows: [] });
    const g = map.get(key);
    g.basePrice += d.basePrice;
    g.bookings += 1;
    g.rows.push(d);
  }

  const byEvent = [...map.values()].map(g => ({
    event: g.event,
    date: g.date,
    basePrice: Math.round(g.basePrice * 100) / 100,
    bookings: g.bookings
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.event.localeCompare(b.event));

  return { rows: detail, byEvent, filePath, sheetName, columns: { colEvent, colDate, colStatus, colBase } };
}

/**
 * FourVenues often shows "New dark mode available" (Light / Dark / System).
 * Always pick Dark, then Accept — otherwise the modal blocks Sales export.
 */
async function dismissPopups(page) {
  try {
    const darkModal = page.getByText(/New dark mode available|dark mode available/i).first();
    if (await darkModal.isVisible({ timeout: 1200 }).catch(() => false)) {
      log('  Theme modal → choosing Dark…');
      // Prefer the Dark option card (subtitle: "Interface in dark tones")
      const darkBySub = page.getByText(/Interface in dark tones/i).first();
      if (await darkBySub.isVisible().catch(() => false)) {
        await darkBySub.click({ timeout: 2000 }).catch(() => {});
      } else {
        const darkCard = page.locator('label, [role="radio"], button, div').filter({ hasText: /^Dark$/i }).first();
        if (await darkCard.isVisible().catch(() => false)) {
          await darkCard.click({ timeout: 2000 }).catch(() => {});
        } else {
          await page.getByText(/^Dark$/i).first().click({ timeout: 2000 }).catch(() => {});
        }
      }
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /^Accept$/i }).click({ timeout: 3000 }).catch(() =>
        page.getByText(/^Accept$/i).first().click().catch(() => {})
      );
      await page.waitForTimeout(800);
      return;
    }
  } catch (_) {}

  await page.getByRole('button', { name: /^Accept$/i }).click({ timeout: 1500 }).catch(() =>
    page.evaluate(() => {
      // Prefer Dark if theme cards are present, then Accept
      const cards = [...document.querySelectorAll('label, [role="radio"], button, div')];
      const dark = cards.find(el => /^Dark$/i.test((el.textContent || '').trim().split('\n')[0] || ''));
      if (dark) dark.click();
      for (const b of document.querySelectorAll('button')) {
        const t = (b.textContent || '').trim();
        if (/^Accept$/i.test(t) || /^Aceptar$/i.test(t)) { b.click(); break; }
      }
    }).catch(() => {})
  );
}

/** Newest sales_*.xls under Downloads newer than sinceMs. */
function recoverDownloadFromDownloads(sinceMs) {
  const dl = path.join(process.env.USERPROFILE || '', 'Downloads');
  if (!fs.existsSync(dl)) return null;
  const files = fs.readdirSync(dl)
    .filter(f => /^sales_.*\.xls/i.test(f) || /^sale-detail-.*\.xlsx?/i.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(dl, f)).mtimeMs }))
    .filter(x => x.t >= sinceMs - 2000)
    .sort((a, b) => b.t - a.t);
  return files.length ? path.join(dl, files[0].f) : null;
}

/**
 * FourVenues emails the export (no browser download).
 * Poll Outlook inbox for Sales Report from no-reply@fourvenues.com after sinceMs,
 * unwrap TitanHQ → S3 URL (optionally match venue.id), download .xlsx.
 */
function fetchSalesReportFromOutlook({ sinceMs, venueId, outFile, timeoutSec = 180 }) {
  const ps1 = path.join(__dirname, 'fv-outlook-fetch-sales.ps1');
  const afterIso = new Date(sinceMs).toISOString();
  const { execFileSync } = require('child_process');
  log(`  📬 Waiting for Outlook Sales Report email (venueId=${venueId || 'any'}, ≤${timeoutSec}s)…`);
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', ps1,
      '-AfterIso', afterIso,
      '-VenueId', venueId || '',
      '-OutFile', outFile,
      '-TimeoutSec', String(timeoutSec)
    ], { encoding: 'utf8', timeout: (timeoutSec + 30) * 1000, windowsHide: true });
    const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
    const json = JSON.parse(line);
    if (!json.ok) throw new Error(json.error || 'Outlook fetch failed');
    log(`  ✅ Email report saved ${json.outFile} (${json.size} bytes, received ${json.received})`);
    return json.outFile;
  } catch (e) {
    const msg = e.stdout || e.message;
    throw new Error('Outlook Sales Report fetch failed: ' + String(msg).slice(0, 300));
  }
}

/**
 * Optional Microsoft Graph mailbox fetch (set MS_GRAPH_TOKEN or GRAPH_ACCESS_TOKEN).
 * Same email as Outlook path: no-reply@fourvenues.com / subject Sales Report → S3 link.
 */
async function fetchSalesReportViaGraph({ sinceMs, venueId, outFile } = {}) {
  const token = process.env.MS_GRAPH_TOKEN || process.env.GRAPH_ACCESS_TOKEN;
  if (!token) return null;
  const sinceIso = new Date(sinceMs || Date.now() - 10 * 60 * 1000).toISOString();
  const filter = encodeURIComponent(
    `from/emailAddress/address eq 'no-reply@fourvenues.com' and receivedDateTime ge ${sinceIso}`
  );
  const listUrl = `https://graph.microsoft.com/v1.0/me/messages?$top=15&$orderby=receivedDateTime desc&$filter=${filter}&$select=id,subject,receivedDateTime,body`;
  log('  📬 Trying Microsoft Graph for Sales Report…');
  const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Graph list ' + res.status);
  const data = await res.json();
  for (const msg of data.value || []) {
    if (!/^Sales Report$/i.test(String(msg.subject || '').trim())) continue;
    const html = (msg.body && msg.body.content) || '';
    const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1].replace(/&amp;/g, '&'));
    let target = null;
    for (const l of hrefs) {
      let u = l;
      const m = u.match(/url=([^&]+)/);
      if (m) u = decodeURIComponent(m[1]);
      if (venueId && !u.includes(venueId)) continue;
      if (/export_excel|sale-detail|\.xls/i.test(u)) { target = u; break; }
    }
    if (!target) continue;
    const dest = outFile || path.join(OUT_DIR, `graph_sales_${Date.now()}.xlsx`);
    const fileRes = await fetch(target);
    if (!fileRes.ok) continue;
    fs.writeFileSync(dest, Buffer.from(await fileRes.arrayBuffer()));
    log(`  ✅ Graph email → ${dest}`);
    return dest;
  }
  return null;
}

/** Ensure we are on Sales → Overview (never Tickets / sales-tickets). */
async function ensureSalesOverview(page, venue) {
  const url = `https://pro.fourvenues.com/${venue.slug}/reports/sales-overview`;
  const bad = /sales-tickets|dashboard-sales|sales-breakdown/i;

  async function onOverview() {
    const u = page.url();
    return u.includes('sales-overview') && !bad.test(u);
  }

  if (!(await onOverview())) {
    log(`  Navigating to Overview (${url})…`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await dismissPopups(page);
  }

  // Click Overview tab if Tickets/other is active
  const overviewTab = page.getByRole('link', { name: /^Overview$/i }).first()
    .or(page.getByRole('tab', { name: /^Overview$/i }).first())
    .or(page.locator('a, button, [role="tab"]').filter({ hasText: /^Overview$/i }).first());
  if (await overviewTab.isVisible().catch(() => false)) {
    await overviewTab.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }

  if (!(await onOverview())) {
    log(`  ↩️ Still on ${page.url()} — forcing ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await dismissPopups(page);
  }

  if (!(await onOverview())) {
    throw new Error(`Expected sales-overview, got ${page.url()} (Tickets/other is wrong)`);
  }
  // Refuse tickets even if overview text is visible
  if (/sales-tickets/i.test(page.url())) {
    throw new Error('Refusing sales-tickets — Overview required');
  }
  log(`  ✅ On Overview: ${page.url()}`);
  return url;
}

/** Open ⋮ immediately to the RIGHT of "Compare events", then click Export to Excel. */
async function clickExportToExcel(page) {
  log('  ⋮ next to Compare events…');

  // Snapshot footer "Export to Excel" ghosts BEFORE opening the menu
  const before = await page.evaluate(() =>
    [...document.querySelectorAll('div, button, a, span, li, [role="menuitem"]')]
      .filter(el => /^(Export to Excel|Exportar a Excel)$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim()))
      .map(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })
  );

  const opened = await page.evaluate(() => {
    const compare = [...document.querySelectorAll('button, a, [role="button"]')]
      .find(b => /^Compare events$/i.test((b.textContent || '').replace(/\s+/g, ' ').trim()));
    if (!compare) return { ok: false, reason: 'Compare events not found' };

    const cr = compare.getBoundingClientRect();
    let root = compare.parentElement;
    for (let i = 0; i < 5 && root; i++, root = root.parentElement) {
      const buttons = [...root.querySelectorAll('button')];
      const candidates = buttons.filter(b => {
        if (b === compare) return false;
        const r = b.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const hasEllipsis = !!(b.querySelector('i.fa-ellipsis-v, i.fa-ellipsis-vertical, i.fa-ellipsis, svg')
          || /more_vert|ellipsis/i.test(b.innerHTML || '')
          || /more|options|menu/i.test((b.getAttribute('aria-label') || '') + (b.getAttribute('title') || '')));
        const nearRight = r.left >= cr.right - 8 && Math.abs(r.top - cr.top) < 40;
        const emptyish = !(b.textContent || '').trim();
        return nearRight && (hasEllipsis || emptyish);
      });
      candidates.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      if (candidates[0]) {
        candidates[0].click();
        return { ok: true, via: 'sibling-right' };
      }
      const anyEllipsis = buttons.find(b =>
        b !== compare && b.querySelector('i.fa-ellipsis-v, i.fa-ellipsis-vertical, i.fa-ellipsis')
      );
      if (anyEllipsis) {
        anyEllipsis.click();
        return { ok: true, via: 'toolbar-ellipsis' };
      }
    }
    return { ok: false, reason: 'ellipsis not found near Compare events' };
  });

  if (!opened.ok) {
    const compare = page.getByRole('button', { name: /Compare events/i }).first();
    if (await compare.isVisible().catch(() => false)) {
      await compare.locator('xpath=following-sibling::button[1]').click({ timeout: 5000 }).catch(() =>
        page.locator('button:has(i.fa-ellipsis-v)').first().click({ timeout: 5000 }).catch(() => {})
      );
    }
  } else {
    log(`  ⋮ opened (${opened.via})`);
  }
  await page.waitForTimeout(1200);

  // Click NEW menu Export item only (not page-footer ghost)
  const clicked = await page.evaluate((beforeList) => {
    const want = /^(Export to Excel|Exportar a Excel)$/i;
    const candidates = [];
    for (const el of document.querySelectorAll('div, button, a, span, li, [role="menuitem"]')) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!want.test(t) || t.length > 40) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const wasBefore = beforeList.some(b =>
        Math.abs(b.x - r.x) < 2 && Math.abs(b.y - r.y) < 2 && Math.abs(b.w - r.width) < 2
      );
      candidates.push({
        el, t, wasBefore,
        area: r.width * r.height,
        y: r.y,
        childCount: el.querySelectorAll('*').length
      });
    }
    candidates.sort((a, b) => {
      if (a.wasBefore !== b.wasBefore) return a.wasBefore ? 1 : -1;
      return (a.childCount - b.childCount) || (a.area - b.area);
    });
    const best = candidates[0];
    if (!best || best.wasBefore) return null;
    best.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    best.el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    best.el.click();
    return { t: best.t, y: Math.round(best.y), area: Math.round(best.area) };
  }, before);

  if (!clicked) {
    log('  ⚠️ Menu Export to Excel not found (avoided page-footer ghost)');
    return false;
  }
  log(`  clicked ${clicked.t} (menu y=${clicked.y})`);

  // Confirm dialog: "Export data" → emails XLS (do NOT click "Send")
  await page.waitForTimeout(1500);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, 'last-export-dialog.png') }).catch(() => {});
  const confirm = page.getByRole('button', { name: /^Export data$/i });
  for (let i = 0; i < 12; i++) {
    if (await confirm.first().isVisible().catch(() => false)) break;
    await page.waitForTimeout(400);
  }
  if (await confirm.first().isVisible().catch(() => false)) {
    await confirm.first().click({ force: true, timeout: 5000 });
    log('  confirmed Export data (email job queued)');
    await page.waitForTimeout(2000);
    return true;
  }
  log('  ⚠️ Export data confirm dialog not shown');
  return false;
}

async function exportVenueSales(page, venue) {
  log(`── ${venue.name}`);
  await ensureSalesOverview(page, venue);
  await dismissPopups(page);

  // Events filter: <filter-events> chip shows "Event" / "Event (N)" — on Overview only
  log('  Events filter…');
  const fe = page.locator('filter-events').first();
  if (await fe.isVisible().catch(() => false)) {
    await fe.click({ timeout: 8000 });
  } else {
    const chip = page.getByText(/Event(?:s)?\s*\(\d+\)/i).first()
      .or(page.getByRole('button', { name: /^Event/i }).first());
    await chip.click({ timeout: 8000 });
  }
  await page.waitForTimeout(1500);

  // Force Upcoming tab (panel can default to Customise)
  log('  Upcoming…');
  await page.getByRole('tab', { name: /^Upcoming$/i }).click({ timeout: 5000 }).catch(() =>
    page.getByText(/^Upcoming$/i).first().click({ timeout: 8000 })
  );
  await page.waitForTimeout(1200);

  // Select all toggle ON
  log('  Select all…');
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('label, span, div, p')].find(el =>
      /^Select all$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim())
    );
    if (!label) return;
    const root = label.closest('div, label, section') || label.parentElement || label;
    const sw = root.querySelector('[role="switch"]') || root.querySelector('input[type="checkbox"]');
    if (sw) {
      const on = sw.getAttribute('aria-checked') === 'true' || sw.checked === true;
      if (!on) sw.click();
    } else {
      // Click the toggle track next to the label
      const sib = label.parentElement && [...label.parentElement.querySelectorAll('button, [role="switch"], input')].find(x => x !== label);
      if (sib) sib.click();
      else label.click();
    }
  });
  await page.waitForTimeout(800);

  log('  Apply…');
  await page.getByRole('button', { name: /^Apply$/i }).click({ timeout: 8000 }).catch(() =>
    page.getByText(/^Apply$/i).first().click({ timeout: 8000 })
  );
  await page.waitForTimeout(4000);

  // Re-assert Overview before export (never Tickets)
  await ensureSalesOverview(page, venue);

  log('  Export via ⋮ → Export to Excel (emailed, not browser download)…');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sinceMs = Date.now();
  let downloadPath = null;

  const ok = await clickExportToExcel(page);
  if (!ok) throw new Error('Export to Excel menu item not found after opening ⋮');

  // Rare: direct browser download
  try {
    const download = await page.waitForEvent('download', { timeout: 5000 });
    const suggested = download.suggestedFilename() || `sales_${venue.key}.xlsx`;
    const finalPath = path.join(OUT_DIR, `${venue.key}_${suggested}`);
    await download.saveAs(finalPath);
    downloadPath = finalPath;
    log(`  ✅ Browser download saved ${finalPath}`);
  } catch (_) {
    log('  ℹ️ No browser download (expected) — fetching emailed report via Outlook…');
  }

  if (!downloadPath) {
    const recovered = recoverDownloadFromDownloads(sinceMs);
    if (recovered) {
      const finalPath = path.join(OUT_DIR, `${venue.key}_${path.basename(recovered)}`);
      fs.copyFileSync(recovered, finalPath);
      downloadPath = finalPath;
      log(`  ✅ Recovered from Downloads → ${finalPath}`);
    }
  }

  if (!downloadPath) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outFile = path.join(OUT_DIR, `${venue.key}_email_${stamp}.xlsx`);
    try {
      downloadPath = fetchSalesReportFromOutlook({
        sinceMs: sinceMs - 20000,
        venueId: venue.id,
        outFile,
        timeoutSec: 180
      });
    } catch (e) {
      log(`  ⚠️ Outlook: ${e.message.split('\n')[0]}`);
      downloadPath = await fetchSalesReportViaGraph({
        sinceMs: sinceMs - 20000,
        venueId: venue.id,
        outFile
      }).catch(err => {
        log(`  ⚠️ Graph: ${err.message}`);
        return null;
      });
    }
  }

  if (!downloadPath) {
    const recovered = recoverDownloadFromDownloads(sinceMs);
    if (recovered) {
      const finalPath = path.join(OUT_DIR, `${venue.key}_${path.basename(recovered)}`);
      fs.copyFileSync(recovered, finalPath);
      downloadPath = finalPath;
      log(`  ✅ Late Downloads recovery → ${finalPath}`);
    }
  }

  if (!downloadPath) throw new Error(`Could not obtain Sales Excel for ${venue.name} (Outlook/Graph/Downloads)`);
  const parsed = parseSalesExportFile(downloadPath);
  log(`  📊 sheet=${parsed.sheetName || '?'} ${parsed.byEvent.length} events, $${parsed.byEvent.reduce((s, e) => s + e.basePrice, 0).toLocaleString()} base`);
  return { venue: venue.name, venueKey: venue.key, ...parsed };
}

/**
 * Pull Sales exports for one or all venues.
 * @param {{ venue?: string, headless?: boolean }} opts
 */
async function pullSalesExports(opts = {}) {
  const want = opts.venue && opts.venue !== 'all'
    ? VENUES.filter(v => v.key === opts.venue || v.name === opts.venue)
    : VENUES;
  if (!want.length) throw new Error('Unknown venue');

  if (!fs.existsSync(SESSION_PATH)) throw new Error('Missing FV session: ' + SESSION_PATH);

  const sd = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
  const browser = await chromium.launch({
    headless: opts.headless === true,
    args: ['--disable-infobars', '--window-size=1280,900']
  });
  const ctx = await browser.newContext({
    storageState: sd.storageState || sd,
    acceptDownloads: true
  });
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  log('Warming session…');
  await page.goto(`https://pro.fourvenues.com/${want[0].slug}/reports/sales-overview`, {
    waitUntil: 'domcontentloaded', timeout: 45000
  }).catch(() => {});
  await dismissPopups(page);
  await page.waitForTimeout(2500);

  const results = [];
  for (const v of want) {
    try {
      results.push(await exportVenueSales(page, v));
    } catch (e) {
      results.push({ venue: v.name, venueKey: v.key, error: e.message, byEvent: [], rows: [] });
      log(`  ERROR ${v.name}: ${e.message}`);
    }
  }

  await browser.close();

  // Flatten forecast rows: venue + date + event + basePrice
  const forecastRows = [];
  for (const r of results) {
    if (r.error) continue;
    for (const ev of r.byEvent) {
      forecastRows.push({
        venue: r.venue,
        date: ev.date,
        dj: ev.event,
        totalRevenue: ev.basePrice,
        bookings: ev.bookings,
        source: 'fourvenues_sales_export',
        filePath: r.filePath
      });
    }
  }

  const summaryPath = path.join(OUT_DIR, `sales-export-latest.json`);
  fs.writeFileSync(summaryPath, JSON.stringify({ pulledAt: new Date().toISOString(), results, forecastRows }, null, 2));
  log(`Wrote ${summaryPath} (${forecastRows.length} event totals)`);

  return { pulledAt: new Date().toISOString(), results, forecastRows, summaryPath };
}

/** Merge sales-export totals into FORECAST_DATA in index.html (match venue+date, prefer DJ name). */
function applyExportToForecast(forecastRows, dashboardPath) {
  const DASH = dashboardPath || 'C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html';
  let html = fs.readFileSync(DASH, 'latin1');
  const startToken = 'var FORECAST_DATA = [';
  const start = html.indexOf(startToken);
  if (start < 0) throw new Error('FORECAST_DATA not found');
  let depth = 0, end = -1;
  for (let i = start + startToken.length - 1; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') {
      depth--;
      if (depth === 0) { end = html[i + 1] === ';' ? i + 2 : i + 1; break; }
    }
  }
  const FORECAST = JSON.parse(html.slice(start + 'var FORECAST_DATA = '.length, end - (html[end - 1] === ';' ? 1 : 0)));

  const byKey = new Map();
  forecastRows.forEach(r => {
    if (!r.date || !r.venue) return;
    byKey.set(`${r.venue}|${r.date}|${String(r.dj || '').toUpperCase()}`, r);
    // also venue|date for single-event days
    const vd = `${r.venue}|${r.date}`;
    if (!byKey.has(vd)) byKey.set(vd, r);
    else byKey.set(vd + '|#multi', true);
  });

  let updated = 0;
  for (const e of FORECAST) {
    const djKey = `${e.venue}|${e.date}|${String(e.dj || '').toUpperCase()}`;
    let hit = byKey.get(djKey);
    if (!hit && !byKey.get(`${e.venue}|${e.date}|#multi`)) hit = byKey.get(`${e.venue}|${e.date}`);
    if (!hit) continue;
    e.totalRevenue = hit.totalRevenue;
    e.bookedTables = hit.bookings != null ? hit.bookings : e.bookedTables;
    e.hasData = true;
    e._source = 'sales_export';
    // Clear map-invented tier $ so UI never implies a higher total than the export
    if (e.tierSummary && typeof e.tierSummary === 'object') {
      for (const t of Object.keys(e.tierSummary)) {
        if (e.tierSummary[t] && typeof e.tierSummary[t] === 'object') e.tierSummary[t].revenue = 0;
      }
    }
    updated++;
  }

  const newJS = 'var FORECAST_DATA = [\n' + FORECAST.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n];';
  html = html.slice(0, start) + newJS + html.slice(end);
  fs.writeFileSync(DASH, html, 'latin1');
  return { updated, total: FORECAST.length };
}

module.exports = {
  VENUES, parseSalesExportFile, pullSalesExports, applyExportToForecast,
  isCountableStatus, fetchSalesReportFromOutlook, fetchSalesReportViaGraph
};

if (require.main === module) {
  pullSalesExports({ venue: process.argv.includes('--all') ? 'all' : (process.argv.find(a => a.startsWith('--venue=')) || '').replace('--venue=', '') || 'casa_neos_bc', headless: false })
    .then(r => {
      console.log(JSON.stringify({ forecastRows: r.forecastRows, errors: r.results.filter(x => x.error) }, null, 2));
      if (process.argv.includes('--apply')) {
        const a = applyExportToForecast(r.forecastRows);
        console.log('Applied to FORECAST_DATA', a);
      }
    })
    .catch(e => { console.error(e); process.exit(1); });
}
