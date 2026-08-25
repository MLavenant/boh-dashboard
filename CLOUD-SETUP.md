# Laptop-off automation (Toast + FourVenues)

Website: https://mlavenant.github.io/rdg-dj/  
Robot: this repo (`boh-dashboard`) via GitHub Actions.

## Timing model (important)

GitHub Actions **`schedule:` crons are often hours late**. Do not rely on them for 8:30 AM ET.

| Priority | Trigger | Time | Notes |
|----------|---------|------|--------|
| **1 – Primary** | External cron → `workflow_dispatch` | **8:25 AM America/New_York** | Laptop off; runners start in ~1–2 min |
| **2 – Secondary** | Windows Task on this PC | **8:25** dispatch + **8:30** local refresh | Punctual when PC is on/awake |
| **3 – Retry** | Same dispatch again | **9:00** and **9:30 AM ET** | If morning failed, retry; success clears Sanity RED. If still failing after 9:30, Sanity stays RED. |
| **4 – Backup** | GitHub `schedule:` in `rdg-daily.yml` | Late morning / afternoon | Catch-up only |

## Punctual primary: cron-job.org → workflow_dispatch

One-time setup (free tier is enough):

1. Create a **fine-scoped GitHub PAT** (classic or fine-grained) with:
   - Fine-grained: Repository `MLavenant/boh-dashboard` → **Actions: Read and write**, **Contents: Read**
   - Classic: scopes `repo` + `workflow`
2. **Do not** reuse any token previously stored in Firebase `rdg/config` (rotate that one if it was ever exposed).
3. Go to [https://cron-job.org](https://cron-job.org) → Create cron job:
   - **Title:** `RDG Daily Dispatch 825 ET`
   - **URL:**  
     `https://api.github.com/repos/MLavenant/boh-dashboard/actions/workflows/rdg-daily.yml/dispatches`
   - **Schedule:** every day at **08:25**, timezone **America/New_York**
   - **Request method:** `POST`
   - **Headers:**
     - `Authorization: Bearer YOUR_PAT_HERE`
     - `Accept: application/vnd.github+json`
     - `X-GitHub-Api-Version: 2022-11-28`
     - `User-Agent: rdg-cron-dispatch`
     - `Content-Type: application/json`
   - **Body (raw JSON):**
     ```json
     {"ref":"main","inputs":{"job":"both"}}
     ```
4. Save. Expected response: **HTTP 204** (empty body).
5. Duplicate the same job twice more for retries:
   - **Title:** `RDG Daily Dispatch 900 ET` — schedule **09:00** America/New_York — same URL/headers/body
   - **Title:** `RDG Daily Dispatch 930 ET` — schedule **09:30** America/New_York — same URL/headers/body  
   Re-running after a success is harmless; after a failure it clears Sanity RED when the retry succeeds. If still failing after 9:30, Sanity stays **RED**.
6. Optional test from this PC (uses your logged-in `gh`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\Users\MatthiasLavenant\Documents\boh-dashboard\trigger-rdg-daily-dispatch.ps1
   ```
   Or: `node trigger-rdg-daily-dispatch.cjs both` with `GH_TOKEN` set.

Helpers in this repo:
- `trigger-rdg-daily-dispatch.ps1`
- `trigger-rdg-daily-dispatch.cjs`

## Secondary: Windows Task Scheduler (this PC)

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\MatthiasLavenant\Documents\boh-dashboard\install-rdg-morning-task.ps1
```

Uses existing task name slots (new names are often blocked by corporate policy):
- `RDG-Toast-BS-Daily` → `workflow_dispatch` at **8:25**
- `RDG DJ FourVenues Daily 830` → local `rdg-morning-refresh.cjs` at **8:30**  
  (wake to run, allow battery, do not stop on battery)

Logs: `boh-dashboard\logs\`.

## Toast BS

Wed–Sun via the same daily workflow (Mon/Tue Toast job skipped).  
Secrets: `TOAST_CLIENT_ID`, `TOAST_API_SECRET`, `RDG_DJ_TOKEN`.

## FourVenues (Integrations API)

```
workflow_dispatch / schedule
  → FourVenues Integrations API (X-Api-Key)
  → bookings price (accepted + not-completed)
  → Firebase forecastLive → Dashboard
```

No Outlook, Graph, Playwright, or `FV_SESSION_B64`. Same metric as Sales Overview export Base price.

## Forecast flash email (auto “Send all emails”)

**Current path (no Azure admin):** local **Outlook** on this PC at Mon–Fri **9:00 / 9:30** ET.

| Time (ET) | Behavior |
|-----------|----------|
| **9:00** | Cloud FV/Toast retry + local Outlook send if FourVenues OK (polls ~8 min). |
| **9:30** | Retry once. If still cannot send → **one** alert to `matthias@rivieradininggroup.com` via Outlook. |
| Lock | Firebase `rdg/scrapeStatus/forecastEmail` — max **one** flash email per Miami day. |

Install / refresh tasks:
```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\MatthiasLavenant\Documents\boh-dashboard\install-rdg-morning-task.ps1
```

Requires: PC on/awake, Outlook desktop signed in. Manual test:
```bat
set FORECAST_EMAIL_VIA=outlook
set FORECAST_EMAIL_ATTEMPT=900
node send-forecast-flash-email.cjs
```

**Later (laptop-off):** Azure Application permission **Mail.Send** + set workflow `FORECAST_EMAIL_VIA` back to `graph`.

### Secrets (GitHub → Settings → Secrets → Actions)

| Secret | Venue |
|--------|--------|
| `FV_API_KEY_MILA` | MILA Lounge |
| `FV_API_KEY_CASA_NEOS` | Casa Neos Lounge |
| `FV_API_KEY_CASA_NEOS_BC` | Casa Neos Beach Club |

Optional later: `FV_API_KEY_AVA` (AVA Lounge — not used for DJ Forecast today).

Create keys in the FourVenues Developer Portal. **Never commit keys** to git. If a key was pasted into chat, rotate it after wiring works.

### Local / Cursor MCP

Put the same three vars in `C:\Cursor\toast-mcp-server\.env` (gitignored). MCP server `fourvenues` loads them via `fv-api-client.cjs`.

Tools: `list_fourvenues_venues`, `get_events`, `get_bookings`, `get_forecast_actuals`.

### Manual run

Actions → **RDG Daily Forecast + Toast** → Run workflow → job **both**  
(or the dispatch script / cron-job.org — not the delayed GitHub schedule).
