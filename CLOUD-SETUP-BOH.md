# Laptop-off automation (BOH Kitchen Dashboard)

Website: https://mlavenant.github.io/boh-dashboard/dashboard.html  
Robot: this repo (`boh-dashboard`) via **GitHub-hosted Actions**, matching DJ.

The laptop can be off. BOH keeps the current Toast Web Admin kitchen reports
by restoring an encrypted browser session from a GitHub Actions secret.

## Timing model

| Priority | Trigger | Time | Notes |
|----------|---------|------|-------|
| Primary | GitHub Actions `schedule:` | Monday ~8:30 AM ET | Hosted runner; laptop off |
| Backup | Second GitHub schedule | Monday ~9:00 AM ET | Retries the same idempotent week |
| Manual | Actions → BOH Weekly Refresh | Any time | Pulls previous full week |

No self-hosted runner, Windows Task Scheduler, PAT, cron-job.org, or `gh auth`
is required for the primary cloud job.

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
| `TOAST_SESSION_GZIP_B64` | Compressed Toast Web Admin browser session |
| `OT_USERNAME` | OpenTable GuestCenter login |
| `OT_PASSWORD` | OpenTable GuestCenter password |
| `OT_CLIENT_ID` | Optional; default OpenTable client ID is built in |

The workflow uses its default `GITHUB_TOKEN` with `contents: write` to update Pages.

### Create / refresh the Toast session secret

1. Locally refresh Toast:
   ```powershell
   cd C:\Cursor\toast-mcp-server
   node intercept.js
   ```
2. Compress and copy the session:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\prepare-boh-cloud-session.ps1
   ```
3. Add or update secret `TOAST_SESSION_GZIP_B64`:
   https://github.com/MLavenant/boh-dashboard/settings/secrets/actions

If System reports Toast 401/session expiry, repeat these three steps.

## Manual / on-demand rerun

Actions → **BOH Weekly Refresh** → Run workflow.

## Local emergency (laptop)

```bat
weekly-auto-run.bat
```

Still works as an emergency backup. GitHub-hosted Actions is primary.
