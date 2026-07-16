/**
 * Monday Toast refresh — BS Actual + VIP table breakdown
 * Schedule: Mondays 8:30 AM (America/New_York)
 * Does NOT run FourVenues (that's daily).
 */
const { execSync } = require("child_process");
const path = require("path");

const ROOT = "C:\\Cursor\\toast-mcp-server";

function log(msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function run(cmd, label) {
  log(`→ ${label}`);
  execSync(cmd, { stdio: "inherit", shell: "cmd.exe", cwd: ROOT });
}

(async () => {
  log("=== Monday Toast Refresh Starting ===");
  let ok = true;
  let message = "";

  try {
    run(`node "${path.join(ROOT, "toast-bs-update.cjs")}"`, "Toast BS Actual update");
  } catch (e) {
    ok = false;
    message += "BS update failed. ";
    log("ERROR BS: " + e.message.split("\n")[0]);
  }

  try {
    run(`node "${path.join(ROOT, "fetch-lastweek-vip.mjs")}"`, "Fetch VIP table breakdown");
    run(`node "${path.join(ROOT, "inject-vip-w29.mjs")}"`, "Inject VIP into dashboard");
  } catch (e) {
    ok = false;
    message += "VIP inject failed. ";
    log("ERROR VIP: " + e.message.split("\n")[0]);
  }

  // Push any remaining local changes from VIP inject if toast-bs-update already pushed
  try {
    run(
      `cd /d "C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard" && git add -A && git diff --cached --quiet || (git commit -m "Auto-refresh: Monday Toast VIP — %DATE%" && git push origin main)`,
      "Git push VIP (if needed)"
    );
  } catch (e) {
    log("Git note: " + e.message.split("\n")[0]);
  }

  if (!message) message = "Toast BS + VIP updated";

  try {
    run(
      `node "${path.join(ROOT, "fb-scrape-status.cjs")}" toast ${ok ? "ok" : "fail"} "${message.replace(/"/g, "")}"`,
      "Write scrape status"
    );
  } catch (e) {
    log("Status write error: " + e.message.split("\n")[0]);
  }

  log(ok ? "=== Monday Toast Refresh Complete ===" : "=== Monday Toast Refresh Finished WITH ERRORS ===");
  process.exit(ok ? 0 : 1);
})();
