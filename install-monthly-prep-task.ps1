#Requires -RunAsAdministrator
<#
  Registers "BOH Dashboard Monthly Prep Stations" — 1st of each month @ 9:00 AM.
  Scrapes Toast Bulk Editor → data/prep-stations-*.json → item-station-map.json

  Run once elevated:
    powershell -ExecutionPolicy Bypass -File C:\Cursor\boh-rdg-publish\install-monthly-prep-task.ps1
#>

$ErrorActionPreference = 'Stop'
$taskName = 'BOH Dashboard Monthly Prep Stations'
$bat = 'C:\Cursor\boh-rdg-publish\monthly-prep-stations.bat'
$root = 'C:\Cursor\boh-rdg-publish'

if (-not (Test-Path $bat)) { throw "Missing $bat" }

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$bat`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 4 -DaysOfWeek Sunday -At 9:00am
# Monthly on day 1 — use CIM for precise monthly trigger
$trigger = New-ScheduledTaskTrigger -Daily -At 9:00am
$trigger.DaysInterval = 1
$trigger.StartBoundary = (Get-Date -Year (Get-Date).Year -Month (Get-Date).Month -Day 1 -Hour 9 -Minute 0 -Second 0).ToString('yyyy-MM-ddTHH:mm:ss')

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Highest

# Use schtasks for reliable "monthly on day 1" (Register-ScheduledTask monthly is awkward in PS 5)
schtasks /Delete /TN $taskName /F 2>$null | Out-Null
schtasks /Create /TN $taskName /TR "cmd.exe /c `"$bat`"" /SC MONTHLY /D 1 /ST 09:00 /RL HIGHEST /F | Out-Null

Write-Host "Registered: $taskName"
Write-Host "  Script : $bat"
Write-Host "  When   : 1st of every month @ 9:00 AM"
Write-Host "  Output : data/prep-stations-{venue}.json + item-station-map.json"
Write-Host ""
Write-Host "Run now manually:"
Write-Host "  cmd /c `"$bat`""
