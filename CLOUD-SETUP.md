# Simple automation (what we use now)

## Toast BS — automatic (cloud)
- **GitHub Actions** on `boh-dashboard` runs Wed–Sun ~8:30 AM ET
- Needs secrets: `TOAST_CLIENT_ID`, `TOAST_API_SECRET`, `RDG_DJ_TOKEN`
- Updates the published DJ Dashboard (`rdg-dj`)

## FourVenues Forecast — local (simple)
Cloud FourVenues kept failing (login/session). So Forecast is refreshed on **this PC**:

1. Double-click: `C:\Cursor\toast-mcp-server\refresh-forecast.bat`
2. Wait until it says DONE
3. Everyone sees updated Forecast via Firebase (no Pages redeploy needed)

If it says login expired:
```powershell
cd C:\Cursor\toast-mcp-server
node fv-relogin-save.cjs
```
Then run the `.bat` again.

## LIVE
- No night auto-scrape
- Press **Refresh** on the LIVE page (needs Firebase `rdg/config` dispatch token, or skip LIVE for now)

## Sanity
Sidebar → **Sanity** shows last run status for Toast / FourVenues / LIVE.
