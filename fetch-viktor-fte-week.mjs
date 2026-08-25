/**
 * Weekly Viktor Ops FTE Excel export (People tab).
 *
 * Opens the share dashboard in Edge, clicks Export to Excel, validates the
 * People sheet + week label, saves to data/fte/RDG_FTE_Week_{NN}_summary.xlsx.
 *
 * Usage:
 *   node fetch-viktor-fte-week.mjs [2026-W34]
 *   node fetch-viktor-fte-week.mjs 2026-W34 --reuse   # skip browser if file already valid
 *
 * Env:
 *   VIKTOR_FTE_DASHBOARD_URL  share URL with ?t=…
 *   VIKTOR_FTE_HEADLESS=1     optional headless (default headed)
 */
import { chromium } from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

dotenv.config({ path: path.join(__dirname, '.env'), override: true });
dotenv.config({ path: path.join('C:', 'Cursor', 'toast-mcp-server', '.env'), override: false });

const ROOT = process.env.BOH_ROOT || __dirname;
const FTE_DIR = path.join(ROOT, 'data', 'fte');
const DEFAULT_URL =
  process.env.VIKTOR_FTE_DASHBOARD_URL ||
  'https://z37nyd7qjhbsojam.viktor.space/dashboard?t=77206968f9f10a3616f9f0ce';

function inferLatestWeek() {
  const dataRoot = path.join(ROOT, 'data');
  if (!fs.existsSync(dataRoot)) return null;
  const weeks = fs
    .readdirSync(dataRoot)
    .filter((d) => /^\d{4}-W\d{2}$/.test(d))
    .sort();
  return weeks.length ? weeks[weeks.length - 1] : null;
}

function weekNumFromLabel(weekLabel) {
  const m = String(weekLabel).match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`Bad week label: ${weekLabel}`);
  return { year: m[1], weekNum: m[2], n: Number(m[2]) };
}

function outPathForWeek(weekLabel) {
  const { weekNum } = weekNumFromLabel(weekLabel);
  return path.join(FTE_DIR, `RDG_FTE_Week_${weekNum}_summary.xlsx`);
}

function validateWorkbook(xlsxPath, expectedWeek) {
  if (!fs.existsSync(xlsxPath)) throw new Error(`Missing workbook: ${xlsxPath}`);
  const wb = XLSX.readFile(xlsxPath);
  if (!wb.SheetNames.includes('People')) {
    throw new Error(`People sheet missing. Sheets: ${wb.SheetNames.join(', ')}`);
  }
  const people = XLSX.utils.sheet_to_json(wb.Sheets.People, { defval: '' });
  if (people.length < 50) {
    throw new Error(`People sheet too thin (${people.length} rows)`);
  }
  const { weekNum, n } = weekNumFromLabel(expectedWeek);
  let foundWeek = null;
  if (wb.Sheets.Summary) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Summary, { header: 1, defval: '' });
    const blob = rows
      .slice(0, 5)
      .map((r) => (Array.isArray(r) ? r.join(' ') : String(r)))
      .join(' ');
    const m = blob.match(/WEEK\s+(\d+)/i);
    if (m) foundWeek = String(m[1]).padStart(2, '0');
  }
  if (!foundWeek) {
    const m = path.basename(xlsxPath).match(/Week[_\s-]*(\d+)/i);
    if (m) foundWeek = String(m[1]).padStart(2, '0');
  }
  if (foundWeek && foundWeek !== weekNum && Number(foundWeek) !== n) {
    throw new Error(
      `Week mismatch: workbook week ${foundWeek} ≠ expected ${weekNum} (${expectedWeek})`
    );
  }
  return { peopleRows: people.length, foundWeek: foundWeek || weekNum, sheets: wb.SheetNames };
}

async function downloadViaPlaywright(destPath) {
  const url = DEFAULT_URL;
  if (!url || !/[?&]t=/.test(url)) {
    throw new Error('VIKTOR_FTE_DASHBOARD_URL missing or has no ?t= share token');
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const headless = process.env.VIKTOR_FTE_HEADLESS === '1';
  console.log(`Opening Viktor FTE dashboard (${headless ? 'headless' : 'headed Edge'})…`);

  const browser = await chromium.launch({
    channel: 'msedge',
    headless,
    slowMo: headless ? 0 : 40,
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(2500);

    const exportBtn = page
      .getByRole('button', { name: /export to excel/i })
      .or(page.locator('button:has-text("Export to Excel")'))
      .or(page.locator('text=Export to Excel'));

    await exportBtn.first().waitFor({ state: 'visible', timeout: 60000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      exportBtn.first().click(),
    ]);

    const tmp = await download.path();
    if (!tmp) {
      await download.saveAs(destPath);
    } else {
      fs.copyFileSync(tmp, destPath);
    }
    console.log(`Saved export → ${destPath}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
  const weekLabel = args[0] || inferLatestWeek();
  if (!weekLabel) throw new Error('Pass week label e.g. 2026-W34');

  const dest = outPathForWeek(weekLabel);
  const reuse = flags.has('--reuse');

  if (reuse && fs.existsSync(dest)) {
    try {
      const meta = validateWorkbook(dest, weekLabel);
      console.log(
        `Reusing existing ${path.basename(dest)} (${meta.peopleRows} people, week ${meta.foundWeek})`
      );
      console.log(dest);
      return;
    } catch (e) {
      console.warn(`Existing file invalid (${e.message}); re-fetching…`);
    }
  }

  await downloadViaPlaywright(dest);
  const meta = validateWorkbook(dest, weekLabel);
  console.log(`OK: ${meta.peopleRows} People rows · week ${meta.foundWeek} · sheets ${meta.sheets.join(',')}`);
  console.log(dest);
}

main().catch((e) => {
  console.error('VIKTOR FTE FETCH FAILED:', e.message);
  process.exit(1);
});
