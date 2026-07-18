#Requires -RunAsAdministrator
<#
  Install unattended RDG automation (FourVenues Forecast + Toast BS).
  - Runs as SYSTEM (no interactive login)
  - Keeps PC awake on AC power
  - Lid close does nothing when plugged in

  Run once in elevated PowerShell:
    powershell -ExecutionPolicy Bypass -File C:\Cursor\toast-mcp-server\install-unattended-automation.ps1
#>

$ErrorActionPreference = 'Stop'
$root = 'C:\Cursor\toast-mcp-server'

Write-Host '=== RDG unattended automation install ===' -ForegroundColor Cyan

# --- Power: never sleep on AC; lid close = do nothing on AC ---
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /SETACTIVE SCHEME_CURRENT
# Allow wake timers
powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1
powercfg /SETACTIVE SCHEME_CURRENT
Write-Host 'Power: AC sleep/hibernate disabled; lid close ignored on AC' -ForegroundColor Green

function Register-SystemDailyTask {
  param(
    [string]$Name,
    [string]$Command,
    [string]$Time,   # HH:mm
    [string]$Days = '*'
  )
  schtasks /Delete /TN $Name /F 2>$null | Out-Null
  if ($Days -eq '*') {
    schtasks /Create /TN $Name /TR $Command /SC DAILY /ST $Time /RU SYSTEM /RL HIGHEST /F | Out-Null
  } else {
    schtasks /Create /TN $Name /TR $Command /SC WEEKLY /D $Days /ST $Time /RU SYSTEM /RL HIGHEST /F | Out-Null
  }
  Write-Host "Task registered: $Name @ $Time (SYSTEM)" -ForegroundColor Green
}

# FourVenues unattended — 8:30 AM daily
Register-SystemDailyTask `
  -Name 'RDG DJ FourVenues Daily 830' `
  -Command "wscript.exe $root\refresh-fv-unattended-silent.vbs" `
  -Time '08:30'

# Toast BS Actual — 9:15 AM daily (API — no browser login)
Register-SystemDailyTask `
  -Name 'RDG-Toast-BS-Daily' `
  -Command "cmd.exe /c $root\refresh-toast-daily.bat" `
  -Time '09:15'

# Toast Monday full refresh — keep if bat exists
if (Test-Path "$root\refresh-toast-silent.vbs") {
  Register-SystemDailyTask `
    -Name 'RDG DJ Toast Monday 830' `
    -Command "wscript.exe $root\refresh-toast-silent.vbs" `
    -Time '08:30' `
    -Days 'MON'
}

Write-Host ''
Write-Host 'IMPORTANT:' -ForegroundColor Yellow
Write-Host '  1) Leave this PC plugged in (AC). Sleep is disabled on AC.'
Write-Host '  2) Machine must stay powered (closed lid OK on AC). If powered OFF, jobs will not run.'
Write-Host '  3) Forecast numbers sync to Firebase for all users even if GitHub push fails.'
Write-Host '  4) Optional: set GITHUB_TOKEN in the SYSTEM environment for Pages auto-push.'
Write-Host '  5) Re-login FourVenues in Playwright if session expires (fv-final-session.json).'
Write-Host ''
Write-Host 'Verifying tasks...' -ForegroundColor Cyan
schtasks /Query /TN 'RDG DJ FourVenues Daily 830' /FO LIST | Select-String 'TaskName|Status|Next Run|Run As'
schtasks /Query /TN 'RDG-Toast-BS-Daily' /FO LIST | Select-String 'TaskName|Status|Next Run|Run As'
Write-Host 'Done.' -ForegroundColor Green
