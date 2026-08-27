/**
 * ONE-TIME backfill: Toast Partner API labor time entries per venue, W01→W34.
 * Writes data/{week}/labor-{venue}.json (same shape as fetch-labor-week.cjs).
 *
 * FTE / CDP join is separate — user runs ingest-fte-roster + build-station-staffing.
 *
 * Usage:
 *   node backfill-labor.mjs --venue casa_neos --from 2026-W01 --to 2026-W34 --skip-existing
 *   node backfill-labor.mjs --all --from 2026-W01 --to 2026-W34 --skip-existing
 *   node backfill-labor.mjs --probe-only
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.BOH_ROOT || __dirname;
dotenv.config({ path: path.join(ROOT, ".env"), override: true });

const { fetchVenue, getToken, LABOR_BACKFILL_VENUES } = require("./fetch-labor-week.cjs");

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DEFAULT_FROM = "2026-W01";
const DEFAULT_TO = "2026-W34";
const FISCAL_START = "2025-12-29";

const VENUE_LABELS = {
  casa_neos: "Casa Neos",
  claudie: "Claudie",
  ava_coconut_grove: "AVA Coconut Grove",
  mila: "MILA Miami",
};

function parseArgs(argv) {
  const out = {
    venue: null,
    all: false,
    from: DEFAULT_FROM,
    to: DEFAULT_TO,
    week: null,
    skipExisting: false,
    probeOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--venue") out.venue = argv[++i];
    else if (a === "--all") out.all = true;
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--week") out.week = argv[++i];
    else if (a === "--skip-existing") out.skipExisting = true;
    else if (a === "--probe-only") out.probeOnly = true;
  }
  return out;
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

function statusPath(venue) {
  return path.join(DATA_DIR, `backfill-labor-${venue}-status.json`);
}

function loadStatus(venue) {
  const p = statusPath(venue);
  if (!fs.existsSync(p)) {
    return { venue, fiscalStart: FISCAL_START, createdAt: new Date().toISOString(), weeks: {} };
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveStatus(status) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  status.updatedAt = new Date().toISOString();
  fs.writeFileSync(statusPath(status.venue), JSON.stringify(status, null, 2));
}

function summarize(status, planned) {
  const done = planned.filter((w) => (status.weeks[w.weekKey]?.entryCount || 0) > 0);
  const failed = planned.filter((w) => status.weeks[w.weekKey]?.error);
  const missing = planned.filter((w) => !status.weeks[w.weekKey]?.entryCount && !status.weeks[w.weekKey]?.error);
  const totalEntries = done.reduce((s, w) => s + (status.weeks[w.weekKey].entryCount || 0), 0);
  return {
    planned: planned.length,
    done: done.length,
    failed: failed.length,
    missing: missing.length,
    totalEntries,
    doneWeeks: done.map((w) => w.weekKey),
    missingWeeks: missing.map((w) => w.weekKey),
    failedWeeks: failed.map((w) => w.weekKey),
    ready: missing.length === 0 && failed.length === 0,
  };
}

async function pullWeek(venue, week, skipExisting, status, token) {
  const { weekKey, startDate, endDate } = week;
  const outPath = path.join(DATA_DIR, weekKey, `labor-${venue}.json`);

  if (skipExisting && fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
      const n = existing.entryCount || (existing.entries || []).length;
      if (n > 0) {
        console.log(`  [skip] ${weekKey} already has ${n} time entries`);
        status.weeks[weekKey] = {
          ...(status.weeks[weekKey] || {}),
          skipped: true,
          entryCount: n,
          at: new Date().toISOString(),
        };
        return status.weeks[weekKey];
      }
    } catch { /* re-fetch */ }
  }

  console.log(`\n── ${weekKey} (${startDate} → ${endDate}) ──`);
  const written = await fetchVenue(venue, weekKey, token);
  const payload = JSON.parse(fs.readFileSync(written, "utf8"));
  const entry = {
    startDate,
    endDate,
    entryCount: payload.entryCount || (payload.entries || []).length,
    outPath: written,
    at: new Date().toISOString(),
  };
  status.weeks[weekKey] = entry;
  return entry;
}

export async function runLaborBackfill(args) {
  const venues = args.all
    ? LABOR_BACKFILL_VENUES
    : [args.venue || "casa_neos"];

  for (const v of venues) {
    if (!LABOR_BACKFILL_VENUES.includes(v)) {
      throw new Error(`Unknown venue: ${v}. Use: ${LABOR_BACKFILL_VENUES.join(", ")}`);
    }
  }

  console.log("\n=== ONE-TIME Labor Time Entries backfill ===");
  console.log(`Venues: ${venues.map((v) => VENUE_LABELS[v] || v).join(", ")}`);
  console.log(`Range:  ${args.from} → ${args.to}`);
  console.log(`Output: ${DATA_DIR}/{week}/labor-{venue}.json\n`);

  let token;
  try {
    token = await getToken();
    console.log("Toast Partner API: authenticated");
  } catch (e) {
    throw new Error(`${e.message} — set TOAST_CLIENT_ID / TOAST_API_SECRET in .env`);
  }

  if (args.probeOnly) {
    console.log("Probe OK — ready to backfill labor.");
    return { ok: true };
  }

  const weeks = args.week ? [isoWeekRange(args.week)] : listWeeks(args.from, args.to);
  const allSummaries = {};

  for (const venue of venues) {
    const label = VENUE_LABELS[venue] || venue;
    console.log(`\n╔══ ${label} (${venue}) ══╗`);
    const status = loadStatus(venue);
    status.venue = venue;
    status.fiscalStart = FISCAL_START;

    for (const week of weeks) {
      try {
        await pullWeek(venue, week, args.skipExisting, status, token);
        saveStatus(status);
      } catch (err) {
        console.error(`  [ERROR] ${week.weekKey}: ${err.message}`);
        status.weeks[week.weekKey] = {
          ...(status.weeks[week.weekKey] || {}),
          error: err.message,
          at: new Date().toISOString(),
        };
        saveStatus(status);
        if (/401|403|Missing TOAST/i.test(err.message)) break;
      }
    }

    const summary = summarize(status, weeks);
    status.summary = summary;
    saveStatus(status);
    allSummaries[venue] = summary;

    console.log(`\n═══ ${label} labor summary ═══`);
    console.log(`Done: ${summary.done}/${summary.planned} weeks · ${summary.totalEntries.toLocaleString()} time entries`);
    if (summary.failedWeeks.length) console.log(`Failed: ${summary.failedWeeks.join(", ")}`);
    if (summary.ready) {
      console.log(`✅ ${label.toUpperCase()} TIME ENTRIES COMPLETE (W01–W34).`);
    } else {
      console.log(`⏳ ${label} not finished — re-run with --skip-existing`);
    }
    console.log(`Status: ${statusPath(venue)}`);
  }

  return allSummaries;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runLaborBackfill(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error("Fatal:", e.message);
    process.exit(1);
  });
}
