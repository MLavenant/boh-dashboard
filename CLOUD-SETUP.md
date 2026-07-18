# Cloud automation — laptop can stay OFF

FourVenues Forecast + Toast BS run on **GitHub Actions** (GitHub's servers), every day ~8:30 AM Miami time. Everyone still sees live numbers on https://mlavenant.github.io/rdg-dj/ via Firebase.

## One-time setup (15 minutes)

### 1. Create a GitHub Personal Access Token
1. Open https://github.com/settings/tokens?type=beta (Fine-grained) or classic
2. Token needs:
   - Repo **MLavenant/boh-dashboard**: Read + write (Actions / contents)
   - Repo **MLavenant/rdg-dj**: Read + write (contents) — for Toast BS push
3. Copy the token (you'll paste it twice below)

### 2. Encode your FourVenues session (on this PC, once)
Open **PowerShell** (normal is fine):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Cursor\toast-mcp-server\fv-final-session.json")) | Set-Clipboard
Write-Host "Copied FV_SESSION_B64 to clipboard"
```

### 3. Add GitHub secrets on boh-dashboard
Open: https://github.com/MLavenant/boh-dashboard/settings/secrets/actions

Add these secrets:

| Secret name | Value |
|-------------|--------|
| `FV_SESSION_B64` | Paste from clipboard (step 2) |
| `TOAST_CLIENT_ID` | From `C:\Cursor\toast-mcp-server\.env` |
| `TOAST_API_SECRET` | From `C:\Cursor\toast-mcp-server\.env` |
| `RDG_DJ_TOKEN` | Same GitHub PAT from step 1 |

### 4. Push workflow + enable Actions
If not already pushed, from this PC:

```powershell
cd C:\Cursor\toast-mcp-server
git add .github/workflows/rdg-daily.yml fv-refresh-cloud.cjs toast-bs-cloud.cjs toast-bs-update.cjs CLOUD-SETUP.md
git commit -m "Add GitHub Actions cloud daily FourVenues + Toast"
git push origin main
```

Then open https://github.com/MLavenant/boh-dashboard/actions → enable workflows if asked → **RDG Daily Forecast + Toast** → **Run workflow** (test once).

### 5. Done
- Laptop can be closed / powered off
- Schedule: daily **12:30 UTC** (~8:30 AM ET)
- Forecast updates Firebase → all users see it live
- Toast updates GitHub Pages via push to `rdg-dj`

## If Forecast goes empty later
FourVenues session expired. On any PC with a browser login:

1. Re-capture `fv-final-session.json` (Playwright login once)
2. Re-run the base64 clipboard command
3. Update secret `FV_SESSION_B64` on GitHub

## Optional: disable local Task Scheduler
You no longer need `RDG DJ FourVenues Daily 830` on this laptop.
