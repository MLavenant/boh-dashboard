# Cloud automation — laptop can stay OFF

## How GitHub fits (yes, it’s involved)

| Piece | Repo / place | Role |
|--------|----------------|------|
| **GitHub Pages** | `MLavenant/rdg-dj` → https://mlavenant.github.io/rdg-dj/ | The published website |
| **GitHub Actions** | `MLavenant/boh-dashboard` | Cloud robot that pulls data on a schedule |
| **Firebase** | `rdg-dj-dashboard` RTDB | Instant overlays (Forecast Actuals, LIVE, Sanity) |
| **Your laptop** | optional | Only needed to re-login FourVenues if the session expires |

So: GitHub **hosts** the app and **runs** the daily jobs. Azure / Microsoft Graph are optional extras (email Sales Report, Live Refresh HTTP host).

## Schedules

| Job | When | Writes |
|-----|------|--------|
| FourVenues Forecast | Daily ~8:30 AM ET | Firebase `rdg/forecastLive` |
| Toast BS Actual | Wed–Sun ~8:30 AM ET | `index.html` → push `rdg-dj` (Pages) |
| Toast LIVE | **On demand only** (Refresh button) | Firebase `rdg/liveNight` |

## One-time setup (secrets)

Open https://github.com/MLavenant/boh-dashboard/settings/secrets/actions

| Secret | Value |
|--------|--------|
| `FV_SESSION_B64` | Base64 of `fv-final-session.json` (see below) |
| `TOAST_CLIENT_ID` | From `.env` |
| `TOAST_API_SECRET` | From `.env` |
| `RDG_DJ_TOKEN` | GitHub PAT with push access to `rdg-dj` |

Encode FV session:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Cursor\toast-mcp-server\prepare-cloud-secret.ps1
```

## Wire Live Refresh (required for the button)

Pick **one**:

### A) GitHub dispatch (no Azure)

1. Create a fine-grained PAT with **Actions: Read and write** on `boh-dashboard` only.
2. In Firebase RTDB set:

```
rdg/config/githubDispatchToken = "<PAT>"
rdg/config/githubDispatchRepo = "MLavenant/boh-dashboard"
```

Refresh then fires workflow **RDG Live Refresh**.

### B) HTTP endpoint (Azure App Service / any Node host)

```powershell
cd C:\Cursor\toast-mcp-server
$env:PORT=8787
$env:LIVE_REFRESH_KEY="pick-a-secret"
$env:TOAST_CLIENT_ID="..."
$env:TOAST_API_SECRET="..."
node live-refresh-http.cjs
```

Firebase:

```
rdg/config/liveRefreshUrl = "https://YOUR-HOST"
rdg/config/liveRefreshKey = "pick-a-secret"
```

## Disable old night LIVE task on this PC

```powershell
powershell -ExecutionPolicy Bypass -File C:\Cursor\toast-mcp-server\disable-live-night-task.ps1
```

## Sanity page

In the app sidebar → **Sanity**: overall health, what each job pulls, last run time, and flags if Live Refresh isn’t configured or a job is stale/failed.

## If Forecast goes empty

FourVenues session expired → re-run `node fv-relogin-save.cjs`, then `prepare-cloud-secret.ps1`, update `FV_SESSION_B64`.
