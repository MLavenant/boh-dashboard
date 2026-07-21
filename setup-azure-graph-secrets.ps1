# One-shot: paste Azure + FV values → GitHub secrets
# Requires: gh auth login (once)
#
# Usage:
#   cd C:\Cursor\toast-mcp-server
#   .\setup-azure-graph-secrets.ps1

$ErrorActionPreference = 'Stop'
$Repo = 'MLavenant/boh-dashboard'

Write-Host ""
Write-Host "=== Secrets → GitHub ($Repo) ===" -ForegroundColor Cyan
Write-Host "GRAPH_MAILBOX must be the exact Entra User principal name (Users blade)."
Write-Host ""

$tenant  = Read-Host "AZURE_TENANT_ID"
$client  = Read-Host "AZURE_CLIENT_ID"
$secret  = Read-Host "AZURE_CLIENT_SECRET"
$mailbox = Read-Host "GRAPH_MAILBOX (exact Entra UPN)"
$fvEmail = Read-Host "FV_EMAIL (Google login for FourVenues)"
$fvPass  = Read-Host "FV_PASSWORD"

if (-not $tenant -or -not $client -or -not $secret -or -not $mailbox) {
  throw "Azure values are required."
}

gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "GitHub CLI not logged in. Running: gh auth login" -ForegroundColor Yellow
  gh auth login
}

$tenant  | gh secret set AZURE_TENANT_ID     -R $Repo
$client  | gh secret set AZURE_CLIENT_ID     -R $Repo
$secret  | gh secret set AZURE_CLIENT_SECRET -R $Repo
$mailbox | gh secret set GRAPH_MAILBOX       -R $Repo
if ($fvEmail) { $fvEmail | gh secret set FV_EMAIL -R $Repo }
if ($fvPass)  { $fvPass  | gh secret set FV_PASSWORD -R $Repo }

Write-Host ""
Write-Host "Secrets saved." -ForegroundColor Green
gh secret list -R $Repo | Select-String -Pattern 'AZURE_|GRAPH_MAILBOX|FV_|TOAST_|RDG_DJ'
Write-Host ""
Write-Host "Next: Actions → RDG Daily Forecast + Toast → Run workflow → fourvenues"
