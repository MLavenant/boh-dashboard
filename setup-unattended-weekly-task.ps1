#Requires -RunAsAdministrator
<#
  setup-unattended-weekly-task.ps1
  Reconfigures "BOH Dashboard Weekly Fetch" so it can run when the laptop
  lid is closed / screen locked — as long as the PC is powered and not fully off.

  Run once in an elevated PowerShell:
    powershell -ExecutionPolicy Bypass -File C:\Cursor\toast-mcp-server\setup-unattended-weekly-task.ps1
#>

$ErrorActionPreference = 'Stop'
$taskName = 'BOH Dashboard Weekly Fetch'
$bat = 'C:\Cursor\toast-mcp-server\weekly-auto-run.bat'

if (-not (Test-Path $bat)) { throw "Missing $bat" }

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $existing) { throw "Scheduled task not found: $taskName" }

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$bat`"" -WorkingDirectory 'C:\Cursor\toast-mcp-server'
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 8:30am

# Allow wake + battery; start if missed while asleep (within a day)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
  -MultipleInstances IgnoreNew `
  -RestartCount 1 `
  -RestartInterval (New-TimeSpan -Minutes 10)

# S4U = run whether user is logged on or not, WITHOUT storing password.
# Works for local scripts; Playwright headed browsers may still fail if no desktop.
# Session reuse + headless token refresh is required (weekly-auto-run.bat already prefers that).
$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType S4U `
  -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Updated task: $taskName"
Write-Host "  LogonType : S4U (run whether logged on or not)"
Write-Host "  WakeToRun : enabled"
Write-Host "  Batteries : allowed"
Write-Host "  StartWhenAvailable: enabled (catches missed Monday runs after wake)"
Write-Host ""
Write-Host "Still required for true 'laptop closed' reliability:"
Write-Host "  1) Keep AC power plugged in Monday mornings"
Write-Host "  2) Windows: Settings → System → Power → allow wake timers"
Write-Host "  3) Keep a valid toast-session.json (re-login once if 401s appear)"
Write-Host "  4) Best long-term: always-on mini PC / cloud VM — laptops sleep/hibernate unpredictably"
