# Laptop-off automation (Toast + FourVenues)

Website: https://mlavenant.github.io/rdg-dj/  
Robot: this repo via GitHub Actions.

## Toast BS (working)
Wed–Sun ~8:30 AM ET. Secrets: `TOAST_CLIENT_ID`, `TOAST_API_SECRET`, `RDG_DJ_TOKEN`.

## FourVenues (Sales Report email = the API)

```
Actions → FourVenues Export (saved session) → Outlook Sales Report email
       → Microsoft Graph reads mailbox → Firebase forecastLive → Dashboard
```

### Why not Google login in the cloud?
Google blocks headless login on GitHub Actions. We use a **saved FourVenues session** (`FV_SESSION_B64`) only to click Export. Graph reads the email (like Toast’s API).

### Secrets

| Secret | Purpose |
|--------|---------|
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | Graph app |
| `GRAPH_MAILBOX` | Exact Entra UPN, e.g. `matthias@rivieradininggroup.com` |
| `FV_SESSION_B64` | Playwright session to click Export (refresh when expired) |

App needs **Mail.Read** (Application) + **Grant admin consent**. Do **not** require User.Read.All — we call `/users/{UPN}/messages` directly.

### Refresh FourVenues session (when Export trigger says expired)

On your PC:

```bat
cd /d C:\Cursor\toast-mcp-server
node fv-relogin-save.cjs
```

Log in in the browser window. Then set secret `FV_SESSION_B64` (gzipped base64 of `fv-final-session.json`), or run `set-fv-secret.ps1` if you use that helper.

### Run

Actions → **RDG Daily Forecast + Toast** → **fourvenues**
