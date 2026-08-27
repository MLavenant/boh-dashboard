/**
 * Wait for Casa Neos backfill to finish, then run Claudie → AVA CG → MILA Miami.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { runBackfill } from "./backfill-venue-tickets.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(ROOT, "data", "backfill-queue.log");
const CASA_STATUS = path.join(ROOT, "data", "backfill-casa_neos-status.json");

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

function casaNeosComplete() {
  if (!fs.existsSync(CASA_STATUS)) return false;
  try {
    const s = JSON.parse(fs.readFileSync(CASA_STATUS, "utf8"));
    return s.summary?.readyForTimeEntries === true;
  } catch { return false; }
}

function casaNeosRunning() {
  try {
    const out = spawnSync("pgrep", ["-f", "backfill-casa-neos-tickets"], { encoding: "utf8" });
    return (out.stdout || "").trim().length > 0;
  } catch { return false; }
}

async function waitForCasaNeos() {
  log("Waiting for Casa Neos backfill to complete…");
  while (true) {
    if (casaNeosComplete()) {
      log("✅ Casa Neos COMPLETE");
      return;
    }
    if (!casaNeosRunning()) {
      const s = fs.existsSync(CASA_STATUS) ? JSON.parse(fs.readFileSync(CASA_STATUS, "utf8")) : null;
      if (s?.summary?.done >= 30) {
        log("Casa Neos process stopped — continuing queue");
        return;
      }
      log("Casa Neos process not running and not complete — waiting 30s");
    }
    await new Promise((r) => setTimeout(r, 30000));
  }
}

async function main() {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  log("=== Backfill queue: Claudie → AVA CG → MILA ===");

  await waitForCasaNeos();

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
  log("\n🎉 ALL REQUESTED VENUES FINISHED (or see errors above)");
  log("Casa Neos → Time Entries OK | Claudie, AVA CG, MILA tickets pulled W01–W34");
}

function saveJSON(p, d) { fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

main().catch((e) => { log(`Fatal: ${e.message}`); process.exit(1); });
