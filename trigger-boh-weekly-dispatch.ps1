#Requires -Version 5.1
<#
  Punctual trigger for BOH Weekly dashboard refresh.

  GitHub schedule crons are often hours late. workflow_dispatch starts within ~1-2 minutes.
  Use this from:
    - cron-job.org (HTTP equivalent in CLOUD-SETUP-BOH.md) — primary, laptop off
    - Windows Task Scheduler (Monday 8:25 AM) — secondary when PC is on
    - Manual run

  Usage:
    powershell -ExecutionPolicy Bypass -File trigger-boh-weekly-dispatch.ps1
    powershell -ExecutionPolicy Bypass -File trigger-boh-weekly-dispatch.ps1 -Week 2026-W30
#>
param(
  [string]$Week = 'last',
  [string]$Repo = 'MLavenant/boh-dashboard',
  [string]$Workflow = 'BOH Weekly Refresh'
)

$ErrorActionPreference = 'Stop'
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Write-Host "[$ts] Dispatching '$Workflow' week=$Week -> $Repo"

if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh workflow run $Workflow --repo $Repo -f "week=$Week"
  if ($LASTEXITCODE -ne 0) { throw "gh workflow run failed (exit $LASTEXITCODE)" }
  Write-Host "[$ts] OK - workflow_dispatch accepted. Self-hosted BOH runner should start within ~1-2 minutes."
  exit 0
}

$token = $env:GH_TOKEN
if (-not $token) { $token = $env:GITHUB_TOKEN }
if (-not $token) {
  throw "Neither 'gh' nor GH_TOKEN/GITHUB_TOKEN available. Install GitHub CLI or set a fine-scoped PAT."
}

$wfFile = 'boh-weekly.yml'
$uri = "https://api.github.com/repos/$Repo/actions/workflows/$wfFile/dispatches"
$body = @{
  ref = 'main'
  inputs = @{ week = $Week }
} | ConvertTo-Json -Depth 5

$headers = @{
  Authorization = "Bearer $token"
  Accept        = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'  = 'boh-weekly-dispatch'
}

Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body -ContentType 'application/json'
Write-Host "[$ts] OK - workflow_dispatch accepted via REST."
