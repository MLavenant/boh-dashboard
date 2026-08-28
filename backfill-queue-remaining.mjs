/**
 * Wait for Casa Neos backfill to finish, then run Claudie → AVA CG → MILA Miami.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { runBackfill } from "./backfill-venue-tickets.mjs";
import { runLaborBackfill } from "./backfill-labor.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(ROOT, "data", "backfill-queue.log");
const CASA_STATUS = path.join(ROOT, "data", "backfill-casa-neos-status.json");

const NEXT_VENUES = [
  { venue: "claudie", label: "Claudie" },
  { venue: "ava_coconut_grove", label: "AVA Coconut Grove" },
  { venue: "mila", label: "MILA Miami" },
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

const CASA_TARGET_WEEKS = 34;

function casaNeosRunning() {
  try {
    const out = spawnSync("pgrep", ["-f", "backfill-casa-neos-tickets.mjs"], { encoding: "utf8" });
    return (out.stdout || "").trim().length > 0;
  } catch { return false; }
}

function casaNeosWeeksDone() {
  if (!fs.existsSync(CASA_STATUS)) return 0;
  try {
    const s = JSON.parse(fs.readFileSync(CASA_STATUS, "utf8"));
    return Object.values(s.weeks || {}).filter((w) => w.kitchenTickets > 0).length;
  } catch { return 0; }
}

function casaNeosFailedWeeks() {
  if (!fs.existsSync(CASA_STATUS)) return [];
  try {
    const s = JSON.parse(fs.readFileSync(CASA_STATUS, "utf8"));
    return Object.entries(s.weeks || {})
      .filter(([, w]) => w.error)
      .map(([k]) => k);
  } catch { return []; }
}

async function waitForCasaNeos() {
  log("Waiting for Casa Neos backfill to complete…");
  while (true) {
    const running = casaNeosRunning();
    const done = casaNeosWeeksDone();
    const failed = casaNeosFailedWeeks();
    if (!running) {
      log(`✅ Casa Neos process finished (${done}/${CASA_TARGET_WEEKS} weeks, ${failed.length} failed)`);
      if (failed.length) log(`   Failed weeks to retry: ${failed.join(", ")}`);
      return failed;
    }
    log(`Casa Neos in progress… ${done}/${CASA_TARGET_WEEKS} weeks (running=${running})`);
    await new Promise((r) => setTimeout(r, 60000));
  }
}

function retryCasaNeosWeeks(weeks) {
  if (!weeks.length) return;
  log(`Retrying Casa Neos failed weeks: ${weeks.join(", ")}`);
  for (const week of weeks) {
    const r = spawnSync(process.execPath, [
      "backfill-casa-neos-tickets.mjs", "--week", week, "--skip-existing",
    ], { cwd: ROOT, encoding: "utf8", stdio: "inherit" });
    if (r.status !== 0) log(`⚠ Casa Neos ${week} retry exited ${r.status}`);
  }
}

async function main() {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  log("=== Backfill queue: Claudie → AVA CG → MILA ===");

  const failedWeeks = await waitForCasaNeos();
  retryCasaNeosWeeks(failedWeeks);

  log("✅ Casa Neos tickets done — you can start Time Entries week-to-week for Casa Neos");

  const results = { casa_neos: "complete", venues: {} };
  for (const { venue, label } of NEXT_VENUES) {
    log(`Starting ${label}…`);
    try {
      const summary = await runBackfill({
        venue, from: "2026-W01", to: "2026-W34", week: null, skipExisting: true, probeOnly: false,
      });
      results.venues[venue] = summary;
      if (summary.readyForTimeEntries) log(`✅ ${label} COMPLETE`);
      else log(`⚠ ${label} incomplete — check status file`);
    } catch (e) {
      log(`❌ ${label} failed: ${e.message}`);
      results.venues[venue] = { error: e.message };
    }
  }

  saveJSON(path.join(ROOT, "data", "backfill-all-status.json"), results);
  log("\n🎉 ALL TICKET BACKFILLS FINISHED (or see errors above)");

  log("\n=== Starting labor time entries (all 4 venues) ===");
  const laborSummaries = await runLaborBackfill({
    all: true,
    from: "2026-W01",
    to: "2026-W34",
    skipExisting: true,
    probeOnly: false,
  });

  const laborReady = ["casa_neos", "claudie", "ava_coconut_grove", "mila"].every(
    (v) => laborSummaries[v]?.ready
  );
  saveJSON(path.join(ROOT, "data", "backfill-labor-all-status.json"), {
    summaries: laborSummaries,
    allReady: laborReady,
    at: new Date().toISOString(),
  });

  if (laborReady) {
    log("\n🎉 ALL LOCATIONS READY — tickets + time entries W01–W34");
    log("You can now run FTE ingest + build-station-staffing per week.");
  } else {
    log("\n⚠ Labor backfill incomplete — re-run: node backfill-labor.mjs --all --skip-existing");
  }
}

function saveJSON(p, d) { fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

main().catch((e) => { log(`Fatal: ${e.message}`); process.exit(1); });
