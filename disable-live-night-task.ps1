# Disable automatic Toast LIVE night scrape (user wants Refresh-only).
# Run once in PowerShell (admin not required for own tasks):
#   powershell -ExecutionPolicy Bypass -File C:\Cursor\toast-mcp-server\disable-live-night-task.ps1

$ErrorActionPreference = 'Continue'
$names = @(
  'RDG-Toast-Live-Night',
  'RDG Toast Live Night',
  'RDG-DJ-Toast-Live-Night'
)
foreach ($n in $names) {
  $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
  if ($t) {
    Disable-ScheduledTask -TaskName $n | Out-Null
    Write-Host "Disabled: $n" -ForegroundColor Green
  } else {
    Write-Host "Not found: $n" -ForegroundColor Yellow
  }
}
Write-Host ""
Write-Host "LIVE now updates only when someone presses Refresh in the app." -ForegroundColor Cyan
