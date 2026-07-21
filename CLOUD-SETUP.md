# Laptop-off automation

## Toast BS (already working)
GitHub Actions Wed–Sun ~8:30 AM ET. Secrets: `TOAST_CLIENT_ID`, `TOAST_API_SECRET`, `RDG_DJ_TOKEN`.

## FourVenues via Microsoft Graph (this setup)

Cloud job reads **Sales Report** emails from your Outlook mailbox (no Playwright, no laptop).

### What you create once (Azure)

1. Open [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**
   - Name: `RDG-DJ-FourVenues-Graph`
   - Supported account types: **Single tenant**
   - Register

2. Copy these values (you will paste them into GitHub):
   - **Directory (tenant) ID** → `AZURE_TENANT_ID`
   - **Application (client) ID** → `AZURE_CLIENT_ID`

3. **Certificates & secrets** → **New client secret** → copy the **Value** once → `AZURE_CLIENT_SECRET`

4. **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**
   - Add **`Mail.Read`**
   - Click **Grant admin consent for …** (required — needs an admin)

5. Note the mailbox that receives FourVenues emails (usually yours):
   - e.g. `matthias@rivieradininggroup.com` → `GRAPH_MAILBOX`

### Put secrets on GitHub (`boh-dashboard`)

Repo → **Settings** → **Secrets and variables** → **Actions** → add:

| Secret | Value |
|--------|--------|
| `AZURE_TENANT_ID` | from step 2 |
| `AZURE_CLIENT_ID` | from step 2 |
| `AZURE_CLIENT_SECRET` | from step 3 |
| `GRAPH_MAILBOX` | your email that gets Sales Report |

(Toast secrets you already have stay as they are.)

### Seed the mailbox (once)

Graph can only read emails that exist. From FourVenues (any PC, once):

1. Sales → Overview → Upcoming → Select all → Export to Excel  
2. Do that for **Casa Neos Beach Club**, **MILA**, and **Casa Neos Lounge**  
3. Confirm three **Sales Report** emails arrive in that mailbox

After that, the daily Actions job can pick them up. When emails get older than ~36h, Sanity warns — run Export again (or we can add an auto-trigger later).

### Test locally (optional)

```powershell
cd C:\Cursor\toast-mcp-server
$env:AZURE_TENANT_ID="..."
$env:AZURE_CLIENT_ID="..."
$env:AZURE_CLIENT_SECRET="..."
$env:GRAPH_MAILBOX="you@company.com"
node test-graph-mail.cjs
node fv-refresh-graph.cjs
```

### Run in cloud

GitHub → `boh-dashboard` → **Actions** → **RDG Daily Forecast + Toast** → **Run workflow** → job `fourvenues`.

### Sanity

Dashboard → **Sanity** shows FourVenues = Graph mailbox path.
