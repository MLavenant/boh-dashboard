#Requires -Version 5.1
<#
  9:00 / 9:30 retry: dispatch cloud FV/Toast, then send Forecast flash via local Outlook.
#>
param(
  [ValidateSet('900', '930')]
  [string]$Attempt = '900',
  [ValidateSet('both', 'fourvenues', 'toast')]
  [string]$Job = 'both'
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dispatch = Join-Path $Root 'trigger-rdg-daily-dispatch.ps1'
$EmailBat = Join-Path $Root 'send-forecast-flash-email-local.bat'

Write-Host "=== Retry $Attempt : cloud dispatch ==="
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Dispatch -Job $Job
} catch {
  Write-Host "Dispatch warn: $($_.Exception.Message)" -ForegroundColor Yellow
}

$env:FORECAST_EMAIL_ATTEMPT = $Attempt
$env:FORECAST_EMAIL_VIA = 'outlook'
Write-Host "=== Retry $Attempt : local Outlook forecast email ==="
cmd /c "`"$EmailBat`""
exit $LASTEXITCODE
