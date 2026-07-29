# Laptop-off automation (BOH Kitchen Dashboard)

Website: https://mlavenant.github.io/boh-dashboard/dashboard.html  
Robot: this repo (`boh-dashboard`) via GitHub Actions on a **self-hosted Windows runner**.

BOH kitchen timing / item details / item fulfillment use Toast **Web Admin** reports (not the official Toast API used by DJ bottle-service). A durable `toast-session.json` must live on the always-on runner.

## Timing model (same as DJ)

GitHub Actions **`schedule:` crons are often hours late**. Do not rely on them for Monday morning.

| Priority | Trigger | Time | Notes |
|----------|---------|------|--------|
| **1 – Primary** | External cron → `workflow_dispatch` | **Mon 8:25 AM America/New_York** | Laptop off; self-hosted runner starts in ~1–2 min |
| **2 – Secondary** | Windows Task on laptop (optional) | **Mon 8:25** dispatch only | Punctual when PC is on/awake — does **not** fetch data |
| **3 – Backup** | GitHub `schedule:` in `boh-weekly.yml` | Late Monday morning | Catch-up only |

## Punctual primary: cron-job.org → workflow_dispatch

One-time setup (free tier is enough):

1. Create a **fine-scoped GitHub PAT** with:
   - Fine-grained: Repository `MLavenant/boh-dashboard` → **Actions: Read and write**, **Contents: Read**
   - Classic: scopes `repo` + `workflow`
2. Go to [https://cron-job.org](https://cron-job.org) → Create cron job:
   - **Title:** `BOH Weekly Dispatch Mon 825 ET`
   - **URL:**  
     `https://api.github.com/repos/MLavenant/boh-dashboard/actions/workflows/boh-weekly.yml/dispatches`
   - **Schedule:** every **Monday** at **08:25**, timezone **America/New_York**
   - **Request method:** `POST`
   - **Headers:**
     - `Authorization: Bearer YOUR_PAT_HERE`
     - `Accept: application/vnd.github+json`
     - `X-GitHub-Api-Version: 2022-11-28`
     - `User-Agent: boh-weekly-dispatch`
     - `Content-Type: application/json`
   - **Body (raw JSON):**
     ```json
     {"ref":"main","inputs":{"week":"last"}}
     ```
3. Save. Expected response: **HTTP 204** (empty body).
4. Optional test from this PC:
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\Cursor\toast-mcp-server\trigger-boh-weekly-dispatch.ps1
   ```
   Or: `node trigger-boh-weekly-dispatch.cjs last` with `GH_TOKEN` set.

Helpers in this repo:
- `trigger-boh-weekly-dispatch.ps1`
- `trigger-boh-weekly-dispatch.cjs`

## Self-hosted Windows runner (required)

See **[BOH-RUNNER-SETUP.md](BOH-RUNNER-SETUP.md)** for install steps.

Labels required: `self-hosted`, `windows`, `boh`

On the runner host you must keep:
- Valid `toast-session.json` (re-login with `node intercept.js` when Toast returns 401)
- Env / secrets: `OT_USERNAME`, `OT_PASSWORD`, optional `TOAST_EMAIL` / `TOAST_PASSWORD`
- Node 20+, Playwright browsers

## What the weekly job writes

### Firebase (`rdg-dj-dashboard-default-rtdb.firebaseio.com`)

| Path | Contents |
|------|----------|
| `/rdg/boh/meta` | `{ latestWeek, updatedAt, venues[] }` |
| `/rdg/boh/weeks/{week}/{venue}` | Processed venue JSON only (~70–250 KB) |
| `/rdg/scrapeStatus/bohWeekly` | Freshness + pass/fail for Settings → System |

Never upload raw kitchen-timing dumps or `rolling.json`.

### GitHub Pages

Rebuilds `dashboard.html` (embedded fallback + Firebase live load) and pushes `main`.

## Secrets (GitHub → Settings → Secrets → Actions)

| Secret | Use |
|--------|-----|
| `OT_USERNAME` | OpenTable GuestCenter login |
| `OT_PASSWORD` | OpenTable GuestCenter password |
| `GH_PUSH_TOKEN` or default `GITHUB_TOKEN` | Push Pages commit from workflow (self-hosted may need PAT with `contents:write`) |

Toast session is **file-based on the runner**, not a GitHub secret (browser cookies refresh in place).

## Manual / on-demand rerun

Actions → **BOH Weekly Refresh** → Run workflow → `week=last` (or `2026-W30`).

## Local emergency (laptop)

```bat
weekly-auto-run.bat
```

Still works when the cloud runner is down. Prefer cloud as primary.
