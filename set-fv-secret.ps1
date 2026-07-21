# Upload FV_SESSION_B64 from file (avoids GitHub UI paste truncation).
# Usage:
#   $env:GH_TOKEN = "ghp_your_token_here"   # same as RDG_DJ_TOKEN
#   powershell -ExecutionPolicy Bypass -File C:\Cursor\toast-mcp-server\set-fv-secret.ps1

$ErrorActionPreference = 'Stop'
Set-Location 'C:\Cursor\toast-mcp-server'

if (-not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
  Write-Host "Set your GitHub token first:" -ForegroundColor Yellow
  Write-Host '  $env:GH_TOKEN = "paste-your-RDG_DJ_TOKEN-here"'
  Write-Host "Then re-run this script."
  exit 1
}

node prepare-fv-session-slim.cjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$b64File = Join-Path (Get-Location) 'fv-session.b64.txt'
if (!(Test-Path $b64File)) { throw "Missing $b64File" }

Write-Host "Uploading FV_SESSION_B64 via gh (no browser paste)..." -ForegroundColor Cyan
gh secret set FV_SESSION_B64 --repo MLavenant/boh-dashboard < $b64File
if ($LASTEXITCODE -ne 0) { throw "gh secret set failed" }

Write-Host "OK — secret uploaded." -ForegroundColor Green
Write-Host "Now re-run: Actions → RDG Daily Forecast + Toast → Run workflow"
