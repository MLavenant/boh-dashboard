# Laptop-off automation (Toast + FourVenues)

Website: https://mlavenant.github.io/rdg-dj/  
Robot repo: this repo (`boh-dashboard`) via GitHub Actions.

## Toast BS (working)
Wed–Sun ~8:30 AM ET. Secrets: `TOAST_CLIENT_ID`, `TOAST_API_SECRET`, `RDG_DJ_TOKEN`.

## FourVenues Forecast (Sales Report email = the API)

Same numbers as Sales → Overview → Export to Excel (Base price, Accepted + Not completed).

Daily ~8:30 AM ET:

1. **Trigger** — Playwright logs into FourVenues and clicks Export for 3 venues (emails go to Outlook)
2. **Read** — Microsoft Graph reads those **Sales Report** emails from your mailbox
3. **Publish** — parse Excel → Firebase `forecastLive` (dashboard overlays for everyone)

```
Actions → FourVenues Export → Outlook mailbox → Graph → Firebase → DJ Dashboard
```

### GitHub secrets required

| Secret | Purpose |
|--------|---------|
| `AZURE_TENANT_ID` | Entra directory ID |
| `AZURE_CLIENT_ID` | App `RDG-DJ-FourVenues-Graph` |
| `AZURE_CLIENT_SECRET` | App client secret **Value** |
| `GRAPH_MAILBOX` | Exact Entra **User principal name** (Azure → Users → your user). Not a guessed alias. |
| `FV_EMAIL` | Google email used for FourVenues |
| `FV_PASSWORD` | Google password for that account |
| `FV_SESSION_B64` | Optional backup session if Google blocks headless login |

Toast secrets stay as they are.

### Fix GRAPH_MAILBOX 404 (“user is invalid”)

1. Azure Portal → **Microsoft Entra ID** → **Users** → open your account  
2. Copy **User principal name** exactly (often `…@mila-group.com`)  
3. Update GitHub secret `GRAPH_MAILBOX` to that value  
4. Re-run Actions → job `fourvenues`

### Azure app (once)

1. App registration `RDG-DJ-FourVenues-Graph` (single tenant)
2. Client secret
3. Application permission **Mail.Read** + **Grant admin consent**

### Manual test

```bash
# Graph only (needs AZURE_* + GRAPH_MAILBOX in env)
node test-graph-mail.cjs
node fv-refresh-graph.cjs

# Full daily path
node fv-daily-cloud.cjs
```

Or Actions → **RDG Daily Forecast + Toast** → Run workflow → `fourvenues`.

### Sanity

Dashboard → **Sanity** shows FourVenues = Export email + Graph (daily, laptop off).
