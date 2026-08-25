# Laptop-off automation (BOH Kitchen Dashboard)

Website: https://mlavenant.github.io/boh-dashboard/dashboard.html  

## Timing model (updated)

| Priority | Trigger | Time | Notes |
|----------|---------|------|-------|
| **1 – Primary** | Windows Task `BOH Dashboard Weekly Fetch` | **Monday 8:30 AM ET** | Runs on this laptop. Opens Edge to refresh Toast login, scrapes last full ISO week, publishes Firebase + Pages, refreshes GitHub secret. |
| 2 – Backup | GitHub Actions `boh-weekly.yml` | Mon ~8:30 / ~9:00 ET | Often fails: Toast Cloudflare blocks hosted runners when cookies are stale. |
| Manual | `C:\Cursor\boh-rdg-publish\weekly-auto-run.bat` | Any time | Same path as the Monday task |

**Why cloud alone is not enough:** Toast Web Admin cookies expire every few days, and GitHub-hosted IPs hit Cloudflare/login. The laptop Edge refresh is required before scrape.

**Requirements for Monday success:** laptop on (and awake) at 8:30 AM ET; complete Cloudflare/2FA in the Edge window if prompted.

## What the weekly job writes

### Firebase (`rdg-dj-dashboard-default-rtdb.firebaseio.com`)

| Path | Contents |
|------|----------|
| `/rdg/boh/meta` | `{ latestWeek, updatedAt, venues[] }` |
| `/rdg/boh/weeks/{week}/{venue}` | Processed venue JSON |
| `/rdg/scrapeStatus/bohWeekly` | Pass/fail for Settings → System |

### GitHub Pages

Rebuilds `dashboard.html` and pushes `main`.

## Secrets (GitHub → Settings → Secrets → Actions)

| Secret | Use |
|--------|-----|
| `TOAST_SESSION_GZIP_B64` | Auto-refreshed by the laptop Monday job after Edge login |
| `OT_USERNAME` / `OT_PASSWORD` | OpenTable covers (optional; kitchen metrics still publish if OT fails) |

### Manual Toast session refresh

```powershell
cd C:\Cursor\boh-rdg-publish
node toast-login-refresh.mjs
powershell -ExecutionPolicy Bypass -File .\prepare-boh-cloud-session.ps1
gh secret set TOAST_SESSION_GZIP_B64 --repo MLavenant/boh-dashboard --body (Get-Clipboard)
```

## Manual / on-demand rerun

```bat
C:\Cursor\boh-rdg-publish\weekly-auto-run.bat
```
