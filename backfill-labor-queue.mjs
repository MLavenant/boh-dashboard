/**
 * Pull labor time entries per venue as soon as that venue's ticket backfill finishes.
 * Order: Casa Neos → Claudie → AVA CG → MILA Miami (W01–W34).
 *
 * FTE / CDP join is left to the user (ingest-fte-roster + build-station-staffing).
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { runLaborBackfill } from "./backfill-labor.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(ROOT, "data", "backfill-labor-queue.log");
const TARGET_WEEKS = 34;

const VENUES = [
  { venue: "casa_neos", label: "Casa Neos" },
  { venue: "claudie", label: "Claudie" },
  { venue: "ava_coconut_grove", label: "AVA Coconut Grove" },
  { venue: "mila", label: "MILA Miami" },
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

function ticketVenueDone(venue) {
  const statusFile =
    venue === "casa_neos"
      ? path.join(ROOT, "data", "backfill-casa-neos-status.json")
      : path.join(ROOT, "data", `backfill-${venue}-status.json`);
  if (!fs.existsSync(statusFile)) return 0;
  try {
    const s = JSON.parse(fs.readFileSync(statusFile, "utf8"));
    return Object.values(s.weeks || {}).filter((w) => w.kitchenTickets > 0).length;
  } catch {
    return 0;
  }
}

function ticketVenueFailed(venue) {
  const statusFile =
    venue === "casa_neos"
      ? path.join(ROOT, "data", "backfill-casa-neos-status.json")
      : path.join(ROOT, "data", `backfill-${venue}-status.json`);
  if (!fs.existsSync(statusFile)) return [];
  try {
    const s = JSON.parse(fs.readFileSync(statusFile, "utf8"));
    return Object.entries(s.weeks || {})
      .filter(([, w]) => w.error)
      .map(([k]) => k);
  } catch {
    return [];
  }
}

function ticketQueueRunning() {
  try {
    const out = spawnSync("pgrep", ["-f", "backfill-queue-remaining.mjs"], { encoding: "utf8" });
    return (out.stdout || "").trim().length > 0;
  } catch {
    return false;
  }
}

async function waitForVenueTickets(venue, label) {
  log(`Waiting for ${label} ticket backfill…`);
  while (true) {
    const done = ticketVenueDone(venue);
    const failed = ticketVenueFailed(venue);
    const queueRunning = ticketQueueRunning();
    if (done >= TARGET_WEEKS - 1 || (!queueRunning && done >= TARGET_WEEKS - 3)) {
      log(`✅ ${label} tickets ready (${done}/${TARGET_WEEKS} weeks${failed.length ? `, ${failed.length} failed` : ""})`);
      return;
    }
    log(`${label} tickets: ${done}/${TARGET_WEEKS} (queue running=${queueRunning})`);
    await new Promise((r) => setTimeout(r, 120000));
  }
}

async function main() {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  log("=== Labor backfill queue: per-venue after tickets W01–W34 ===");

  const summaries = {};

  for (const { venue, label } of VENUES) {
    await waitForVenueTickets(venue, label);
    log(`Starting ${label} labor time entries…`);
    try {
      const result = await runLaborBackfill({
        venue,
        from: "2026-W01",
        to: "2026-W34",
        skipExisting: true,
        probeOnly: false,
      });
      summaries[venue] = result[venue];
      if (result[venue]?.ready) log(`✅ ${label} TIME ENTRIES COMPLETE`);
      else log(`⚠ ${label} labor incomplete — check data/backfill-labor-${venue}-status.json`);
    } catch (e) {
      log(`❌ ${label} labor failed: ${e.message}`);
      summaries[venue] = { error: e.message };
    }
  }

  const allReady = VENUES.every((v) => summaries[v.venue]?.ready);
  fs.writeFileSync(
    path.join(ROOT, "data", "backfill-labor-all-status.json"),
    JSON.stringify({ summaries, allReady, at: new Date().toISOString() }, null, 2)
  );

  if (allReady) {
    log("\n🎉 ALL LOCATIONS READY — tickets + time entries W01–W34");
    log("You can now run FTE ingest + build-station-staffing per week.");
  } else {
    log("\n⚠ Some venues incomplete — re-run: node backfill-labor.mjs --all --skip-existing");
  }
}

main().catch((e) => {
  log(`Fatal: ${e.message}`);
  process.exit(1);
});
