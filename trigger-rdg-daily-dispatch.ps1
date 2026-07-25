#Requires -Version 5.1
<#
  Punctual trigger for RDG Daily Forecast + Toast.

  GitHub schedule crons are often hours late. workflow_dispatch starts within ~1–2 minutes.
  Use this from:
    - Windows Task Scheduler (8:25 AM local)
    - Manual run
    - External cron (cron-job.org) via the HTTP equivalent in CLOUD-SETUP.md

  Usage:
    powershell -ExecutionPolicy Bypass -File trigger-rdg-daily-dispatch.ps1
    powershell -ExecutionPolicy Bypass -File trigger-rdg-daily-dispatch.ps1 -Job toast
#>
param(
  [ValidateSet('both', 'fourvenues', 'toast')]
  [string]$Job = 'both',
  [string]$Repo = 'MLavenant/boh-dashboard',
  [string]$Workflow = 'RDG Daily Forecast + Toast'
)

$ErrorActionPreference = 'Stop'
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Write-Host "[$ts] Dispatching '$Workflow' job=$Job → $Repo"

if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh workflow run $Workflow --repo $Repo -f "job=$Job"
  if ($LASTEXITCODE -ne 0) { throw "gh workflow run failed (exit $LASTEXITCODE)" }
  Write-Host "[$ts] OK — workflow_dispatch accepted. Runners should start within ~1–2 minutes."
  exit 0
}

# Fallback: REST API with GH_TOKEN / GITHUB_TOKEN
$token = $env:GH_TOKEN
if (-not $token) { $token = $env:GITHUB_TOKEN }
if (-not $token) {
  throw "Neither 'gh' nor GH_TOKEN/GITHUB_TOKEN available. Install GitHub CLI or set a fine-scoped PAT."
}

$wfFile = 'rdg-daily.yml'
$uri = "https://api.github.com/repos/$Repo/actions/workflows/$wfFile/dispatches"
$body = @{
  ref = 'main'
  inputs = @{ job = $Job }
} | ConvertTo-Json -Depth 5

$headers = @{
  Authorization = "Bearer $token"
  Accept        = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'  = 'rdg-daily-dispatch'
}

Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body -ContentType 'application/json'
Write-Host "[$ts] OK — workflow_dispatch accepted via REST."
