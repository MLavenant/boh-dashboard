/**
 * ONE-TIME backfill: Kitchen Ticket Details + Item Details per venue, W01→W34.
 * Same Toast CSV export as weekly-save.js (reportDateRange=custom + MM-dd-yyyy).
 *
 * Usage:
 *   node backfill-venue-tickets.mjs --venue casa_neos
 *   node backfill-venue-tickets.mjs --venue claudie --from 2026-W01 --to 2026-W34 --skip-existing
 */

import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.BOH_ROOT || __dirname;
dotenv.config({ path: path.join(ROOT, ".env"), override: true });

const VENUE_CONFIG = {
  casa_neos:         { groupId: "500000037911188149", label: "Casa Neos" },
  claudie:           { groupId: "500000037853698711", label: "Claudie" },
  ava_coconut_grove: { groupId: "500000056033936853", label: "AVA Coconut Grove" },
  mila:              { groupId: "500000000001501691", label: "MILA Miami" },
};

const SESSION_FILE = process.env.TOAST_SESSION_FILE || path.join(ROOT, "toast-session.json");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const TOAST_ADMIN = "https://www.toasttab.com";
const FISCAL_START = "2025-12-29";
const DEFAULT_TO = "2026-W34";

let VENUE = "casa_neos";
let GROUP_ID = VENUE_CONFIG.casa_neos.groupId;
let VENUE_LABEL = VENUE_CONFIG.casa_neos.label;
let STATUS_FILE = path.join(DATA_DIR, "backfill-casa_neos-status.json");

function parseArgs(argv) {
  const out = { venue: "casa_neos", from: "2026-W01", to: DEFAULT_TO, week: null, skipExisting: false, probeOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--venue") out.venue = argv[++i];
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--week") out.week = argv[++i];
    else if (a === "--skip-existing") out.skipExisting = true;
    else if (a === "--probe-only") out.probeOnly = true;
  }
  return out;
}

function setVenue(slug) {
  const cfg = VENUE_CONFIG[slug];
  if (!cfg) throw new Error(`Unknown venue: ${slug}. Use: ${Object.keys(VENUE_CONFIG).join(", ")}`);
  VENUE = slug;
  GROUP_ID = cfg.groupId;
  VENUE_LABEL = cfg.label;
  STATUS_FILE = path.join(DATA_DIR, `backfill-${slug}-status.json`);
}

function isoWeekRange(weekKey) {
  const m = String(weekKey).match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`Bad week key: ${weekKey}`);
  const y = +m[1], w = +m[2];
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (w - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { weekKey, startDate: fmt(monday), endDate: fmt(sunday) };
}

function listWeeks(fromKey, toKey) {
  const weeks = [];
  let cur = isoWeekRange(fromKey);
  const end = isoWeekRange(toKey);
  for (let i = 0; i < 60; i++) {
    weeks.push(cur);
    if (cur.weekKey === end.weekKey) break;
    const nextMon = new Date(cur.startDate + "T12:00:00Z");
    nextMon.setUTCDate(nextMon.getUTCDate() + 7);
    const y = nextMon.getUTCFullYear();
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const day = jan4.getUTCDay() || 7;
    const week1Mon = new Date(jan4);
    week1Mon.setUTCDate(jan4.getUTCDate() - day + 1);
    const weekNum = Math.round((nextMon - week1Mon) / (7 * 86400000)) + 1;
    cur = isoWeekRange(`${nextMon.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`);
  }
  return weeks;
}

function toastCustomQueryParams(startDate, endDate) {
  const fmt = (iso) => {
    const [y, m, d] = iso.split("-");
    return `${m}-${d}-${y}`;
  };
  return { reportDateRange: "custom", reportDateStart: fmt(startDate), reportDateEnd: fmt(endDate) };
}

function buildReportQs(params, groupId) {
  return new URLSearchParams({ excel: "true", numberOfRestaurants: "1", reportGroupIds: groupId, ...params }).toString();
}

function getSessionCookies() {
  if (!fs.existsSync(SESSION_FILE)) throw new Error(`No toast-session.json at ${SESSION_FILE}`);
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  const cookies = (session.cookies || [])
    .filter((c) => String(c.domain || "").includes("toasttab.com"))
    .map((c) => `${c.name}=${c.value}`).join("; ");
  if (!cookies) throw new Error("toast-session.json has no toasttab.com cookies");
  return cookies;
}

function reportHeaders(cookies) {
  return {
    Cookie: cookies,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "*/*",
    "X-Requested-With": "XMLHttpRequest",
    Referer: "https://www.toasttab.com/restaurants/admin/reports/home",
  };
}

function parseCSV(csvText) {
  const lines = csvText.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const fields = [];
    let cur = "", inQuote = false;
    for (const ch of line) {
      if (ch === '"') inQuote = !inQuote;
      else if (ch === "," && !inQuote) { fields.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    fields.push(cur.trim());
    const row = {};
    headers.forEach((h, i) => { if (fields[i] !== undefined) row[h] = fields[i].replace(/^"|"$/g, ""); });
    return row;
  });
}

async function pollCsvExport(s3Url, label, maxPolls = 45) {
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s3Res = await axios.get(s3Url, { validateStatus: () => true });
    const d = s3Res.data;
    if (d.downloadUrl) {
      const csvRes = await axios.get(d.downloadUrl, { responseType: "arraybuffer", validateStatus: () => true });
      return parseCSV(Buffer.from(csvRes.data).toString("latin1"));
    }
    if (d.status === "ERROR" || d.status === "FAILED") {
      throw new Error(`${label} report error: ${d.message || JSON.stringify(d).slice(0, 200)}`);
    }
  }
  throw new Error(`${label} CSV export timed out`);
}

async function fetchKitchenTimingWeek(cookies, startDate, endDate) {
  const qs = buildReportQs(toastCustomQueryParams(startDate, endDate), GROUP_ID);
  const triggerRes = await axios.get(`${TOAST_ADMIN}/restaurantkitchenreports/kitchendetailstable?${qs}`,
    { headers: reportHeaders(cookies), validateStatus: () => true, maxRedirects: 0 });
  const s3Url = triggerRes.headers["location"];
  if (!s3Url) throw new Error(`Kitchen timing: no S3 URL (status ${triggerRes.status})`);
  return pollCsvExport(s3Url, "kitchen-timing");
}

async function fetchItemDetailsWeek(cookies, startDate, endDate) {
  const qs = buildReportQs(toastCustomQueryParams(startDate, endDate), GROUP_ID);
  const triggerRes = await axios.get(`${TOAST_ADMIN}/restaurants/admin/reports/menu/toplevelitemselections?${qs}`,
    { headers: reportHeaders(cookies), validateStatus: () => true, maxRedirects: 0 });
  const s3Url = triggerRes.headers["location"];
  if (!s3Url) throw new Error(`Item details: no S3 URL (status ${triggerRes.status})`);
  const rows = await pollCsvExport(s3Url, "item-details");
  return rows.filter((r) => r["Void?"] !== "true").map((r) => ({
    orderId: r["Order Id"] || "", checkId: r["Check Id"] || "", sentDate: r["Sent Date"] || "",
    menuItem: r["Menu Item"] || "", menuGroup: r["Menu Group"] || "", diningArea: r["Dining Area"] || "",
    table: r["Table"] || "", server: r["Server"] || "",
    qty: parseFloat(r["Qty"]) || 1, netPrice: parseFloat(r["Net Price"]) || 0,
  }));
}

async function probeSession(cookies) {
  const qs = `excel=true&reportDateRange=lastWeek&numberOfRestaurants=1&reportGroupIds=${GROUP_ID}`;
  const res = await axios.get(`${TOAST_ADMIN}/restaurantkitchenreports/kitchendetailstable?${qs}`,
    { headers: reportHeaders(cookies), validateStatus: () => true, maxRedirects: 0 });
  return { status: res.status, hasLocation: Boolean(res.headers["location"]) };
}

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function saveJSON(filePath, data) { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); }

function loadStatus() {
  if (!fs.existsSync(STATUS_FILE)) {
    return { venue: VENUE, fiscalStart: FISCAL_START, createdAt: new Date().toISOString(), weeks: {} };
  }
  return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
}

function saveStatus(status) {
  ensureDir(DATA_DIR);
  status.updatedAt = new Date().toISOString();
  saveJSON(STATUS_FILE, status);
}

function processWeek(weekKey) {
  const r = spawnSync(process.execPath, ["process-venue-data.cjs", VENUE, weekKey], {
    cwd: ROOT, env: process.env, encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`process-venue-data failed: ${(r.stderr || r.stdout || "").slice(0, 400)}`);
  return (r.stdout || "").trim().split("\n").slice(-3).join(" | ");
}

async function pullWeek(cookies, week, skipExisting, status) {
  const { weekKey, startDate, endDate } = week;
  const weekDir = path.join(DATA_DIR, weekKey);
  const ktPath = path.join(weekDir, `kitchen-timing-${VENUE}.json`);
  const idPath = path.join(weekDir, `item-details-${VENUE}.json`);

  if (skipExisting && fs.existsSync(ktPath) && fs.existsSync(idPath)) {
    const n = (JSON.parse(fs.readFileSync(ktPath, "utf8")).tickets || []).length;
    if (n > 0) {
      console.log(`  [skip] ${weekKey} already has ${n} tickets`);
      status.weeks[weekKey] = { ...(status.weeks[weekKey] || {}), skipped: true, kitchenTickets: n, at: new Date().toISOString() };
      return status.weeks[weekKey];
    }
  }

  console.log(`\n── ${weekKey} (${startDate} → ${endDate}) ──`);
  ensureDir(weekDir);

  console.log("  [kitchen] fetching Ticket Details…");
  const tickets = await fetchKitchenTimingWeek(cookies, startDate, endDate);
  if (tickets.length >= 50000) console.warn(`  [kitchen] WARNING: ${tickets.length} rows — may hit 50k cap`);
  saveJSON(ktPath, { weekLabel: weekKey, startDate, endDate, venue: VENUE, tickets });
  console.log(`  [kitchen] ${tickets.length} tickets → ${ktPath}`);

  console.log("  [items] fetching Item Details…");
  const items = await fetchItemDetailsWeek(cookies, startDate, endDate);
  if (items.length >= 50000) console.warn(`  [items] WARNING: ${items.length} rows — may hit 50k cap`);
  saveJSON(idPath, { weekLabel: weekKey, startDate, endDate, venue: VENUE, items });
  console.log(`  [items] ${items.length} items → ${idPath}`);

  let processNote = "";
  try { processNote = processWeek(weekKey); console.log(`  [process] ${processNote || "ok"}`); }
  catch (e) { console.warn(`  [process] ${e.message}`); processNote = e.message; }

  const entry = { startDate, endDate, kitchenTickets: tickets.length, itemDetails: items.length,
    cappedKitchen: tickets.length >= 50000, cappedItems: items.length >= 50000, processNote, at: new Date().toISOString() };
  status.weeks[weekKey] = entry;
  return entry;
}

function summarize(status, planned) {
  const done = planned.filter((w) => (status.weeks[w.weekKey]?.kitchenTickets || 0) > 0);
  const failed = planned.filter((w) => status.weeks[w.weekKey]?.error);
  const missing = planned.filter((w) => !status.weeks[w.weekKey] || (!(status.weeks[w.weekKey]?.kitchenTickets > 0) && !status.weeks[w.weekKey]?.error));
  return {
    planned: planned.length, done: done.length, failed: failed.length, missing: missing.length,
    totalTickets: done.reduce((s, w) => s + (status.weeks[w.weekKey].kitchenTickets || 0), 0),
    doneWeeks: done.map((w) => w.weekKey), missingWeeks: missing.map((w) => w.weekKey),
    failedWeeks: failed.map((w) => w.weekKey),
    readyForTimeEntries: missing.length === 0 && failed.length === 0,
  };
}

export async function runBackfill(args) {
  setVenue(args.venue);
  console.log(`\n=== ONE-TIME ${VENUE_LABEL} Ticket Details backfill ===`);
  console.log(`Session: ${SESSION_FILE} | Data: ${DATA_DIR} | ${FISCAL_START} → ${args.to}\n`);

  const cookies = getSessionCookies();
  const probe = await probeSession(cookies);
  console.log(`Session probe: status=${probe.status} hasLocation=${probe.hasLocation}`);
  if (!probe.hasLocation) throw new Error("Toast session unusable — refresh toast-session.json");
  if (args.probeOnly) { console.log("Probe OK"); return { ok: true }; }

  const weeks = args.week ? [isoWeekRange(args.week)] : listWeeks(args.from, args.to);
  console.log(`Weeks: ${weeks[0].weekKey} … ${weeks[weeks.length - 1].weekKey} (${weeks.length})`);

  const status = loadStatus();
  status.venue = VENUE;
  status.fiscalStart = FISCAL_START;

  for (const week of weeks) {
    try {
      await pullWeek(cookies, week, args.skipExisting, status);
      saveStatus(status);
    } catch (err) {
      console.error(`  [ERROR] ${week.weekKey}: ${err.message}`);
      status.weeks[week.weekKey] = { ...(status.weeks[week.weekKey] || {}), error: err.message, at: new Date().toISOString() };
      saveStatus(status);
      if (/session|401|S3 URL|expired/i.test(err.message)) break;
    }
  }

  const summary = summarize(status, weeks);
  status.summary = summary;
  saveStatus(status);

  console.log(`\n═══ ${VENUE_LABEL} summary ═══`);
  console.log(`Done: ${summary.done}/${summary.planned} weeks · ${summary.totalTickets.toLocaleString()} tickets`);
  if (summary.readyForTimeEntries) {
    console.log(`\n✅ ${VENUE_LABEL.toUpperCase()} TICKET DETAILS COMPLETE (W01–W34).`);
  } else {
    console.log(`\n⏳ ${VENUE_LABEL} not finished — re-run with --skip-existing`);
  }
  console.log(`Status: ${STATUS_FILE}`);
  return summary;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runBackfill(parseArgs(process.argv.slice(2))).catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
}
