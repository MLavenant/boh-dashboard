#Requires -RunAsAdministrator
<#
  Secondary (optional) laptop task: only dispatches boh-weekly.yml at Mon 8:25.
  Does NOT fetch data on the laptop — cloud runner does the work.

  Primary remains cron-job.org (see CLOUD-SETUP-BOH.md).
#>
$ErrorActionPreference = 'Stop'
$taskName = 'BOH Weekly Cloud Dispatch'
$ps1 = 'C:\Cursor\toast-mcp-server\trigger-boh-weekly-dispatch.ps1'
if (-not (Test-Path $ps1)) { throw "Missing $ps1" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ps1`"" `
  -WorkingDirectory 'C:\Cursor\toast-mcp-server'
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 8:25am
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -WakeToRun
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered: $taskName (Mon 8:25) → workflow_dispatch only"
Write-Host "Primary laptop-off path is still cron-job.org + self-hosted runner."
