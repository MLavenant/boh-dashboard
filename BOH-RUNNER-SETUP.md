# BOH self-hosted Windows runner bootstrap

Required for laptop-off Monday updates. Toast kitchen reports need a durable Web Admin session on an always-on Windows host.

## 1. Provision the host

- Always-on Windows Server / Azure VM / dedicated mini PC
- Power & network stable Monday mornings
- Labels will be: `self-hosted`, `windows`, `boh`

## 2. Install prerequisites

```powershell
# Node 20 LTS
winget install OpenJS.NodeJS.LTS

# Git
winget install Git.Git

# Playwright browsers (after npm install in repo)
cd C:\boh-runner\boh-dashboard   # or your clone path
npm ci
npx playwright install
npx playwright install msedge
```

## 3. Register GitHub Actions runner

1. GitHub → `MLavenant/boh-dashboard` → **Settings → Actions → Runners → New self-hosted runner**
2. Choose Windows x64; follow download + configure steps
3. When prompted for labels, add: `boh` (in addition to default `self-hosted` / `Windows`)
4. Install as a **Windows service** so it survives reboot/logoff:
   ```powershell
   .\svc.cmd install
   .\svc.cmd start
   ```

## 4. Clone / sync the repo on the runner

The workflow checks out the repo each run. Persist secrets/session **outside** the ephemeral workspace if needed:

```powershell
# Recommended durable session location
mkdir C:\boh-runner\secrets -Force
# After interactive login (step 5), copy:
#   copy toast-session.json C:\boh-runner\secrets\
```

Set machine-level env (System Properties → Environment Variables, or runner `.env` next to checkout is not durable). Prefer **GitHub Actions secrets** for OT:

| Secret | Value |
|--------|--------|
| `OT_USERNAME` | OpenTable email |
| `OT_PASSWORD` | OpenTable password |
| `GH_PUSH_TOKEN` | Optional PAT with `contents:write` if default `GITHUB_TOKEN` push fails |

Optional runner env:
```
BOH_TOAST_SESSION_DIR=C:\boh-runner\secrets
```

If you store the session outside the workspace, set in the workflow or runner env:
```
TOAST_SESSION_FILE=C:\boh-runner\secrets\toast-session.json
```

(Add that env to `.github/workflows/boh-weekly.yml` if you use a durable path.)

## 5. One-time Toast login on the runner

Interactive desktop session required once (and again when Toast returns 401):

```powershell
cd <checkout or working clone>
# Ensure TOAST_EMAIL / TOAST_PASSWORD in .env (gitignored)
node intercept.js
# Complete 2FA if prompted → toast-session.json saved
```

Copy `toast-session.json` to the durable path if the Actions workspace is cleaned between runs.

**Important:** Configure the Actions checkout to preserve or restore the session file. Simplest approach on a dedicated runner:

Before each job (add as first step if needed), copy session into workspace:

```cmd
if exist C:\boh-runner\secrets\toast-session.json copy /Y C:\boh-runner\secrets\toast-session.json toast-session.json
```

After a successful run that refreshed the session:

```cmd
if exist toast-session.json copy /Y toast-session.json C:\boh-runner\secrets\toast-session.json
```

## 6. Verify

```powershell
# From a machine with GH_TOKEN / gh:
node trigger-boh-weekly-dispatch.cjs last
# Or: Actions → BOH Weekly Refresh → Run workflow
```

Expect:
- Job starts on the self-hosted runner within ~1–2 minutes
- Firebase `/rdg/scrapeStatus/bohWeekly` → `ok: true`
- Live dashboard week advances: https://mlavenant.github.io/boh-dashboard/dashboard.html

## 7. Demote the laptop task

Leave **BOH Dashboard Weekly Fetch** registered as emergency-only, or change it to only run:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Cursor\toast-mcp-server\trigger-boh-weekly-dispatch.ps1
```

Primary publisher = **cron-job.org + self-hosted runner**, not the laptop.
