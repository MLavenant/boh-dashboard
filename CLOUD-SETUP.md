# Laptop-off automation (Toast + FourVenues)

Website: https://mlavenant.github.io/rdg-dj/  
Robot: this repo (`boh-dashboard`) via GitHub Actions.

## Toast BS (working)

Wed–Sun ~8:30 AM ET. Secrets: `TOAST_CLIENT_ID`, `TOAST_API_SECRET`, `RDG_DJ_TOKEN`.

## FourVenues (Integrations API)

```
Actions → FourVenues Integrations API (X-Api-Key)
       → bookings price (accepted + not-completed)
       → Firebase forecastLive → Dashboard
```

No Outlook, Graph, Playwright, or `FV_SESSION_B64`. Same metric as Sales Overview export Base price.

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

### Run

Actions → **RDG Daily Forecast + Toast** → job **fourvenues** (or wait for daily ~8:30 AM ET schedule).
