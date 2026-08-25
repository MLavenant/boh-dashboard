#Requires -Version 5.1
<#
  Install / repair punctual RDG morning automation on this PC.

  Corporate PCs may block *new* task names. This script reuses the existing slots:
    - RDG-Toast-BS-Daily          → 8:25 AM  workflow_dispatch (cloud, punctual)
    - RDG DJ FourVenues Daily 830 → 8:30 AM  local FV + Toast → Firebase

  Both: wake to run, allow battery, do not stop on battery.

  Run (elevated preferred, but often works without):
    powershell -ExecutionPolicy Bypass -File C:\Users\MatthiasLavenant\Documents\boh-dashboard\install-rdg-morning-task.ps1
#>
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DispatchPs1 = Join-Path $Root 'trigger-rdg-daily-dispatch.ps1'
$MorningBat  = Join-Path $Root 'refresh-morning.bat'
$LogDir      = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path $DispatchPs1)) { throw "Missing $DispatchPs1" }
if (-not (Test-Path $MorningBat))  { throw "Missing $MorningBat" }

# Keep AC awake; allow wake timers
powercfg /change standby-timeout-ac 0 2>$null
powercfg /change hibernate-timeout-ac 0 2>$null
powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1 2>$null
powercfg /SETACTIVE SCHEME_CURRENT 2>$null

$dispatchTr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$DispatchPs1`" -Job both"
$morningTr  = "cmd.exe /c `"$MorningBat`""
$Retry900Ps1 = Join-Path $Root 'trigger-rdg-retry-and-forecast-email.ps1'
$Retry930Ps1 = Join-Path $Root 'trigger-rdg-retry-and-forecast-email.ps1'
$retry900Tr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Retry900Ps1`" -Attempt 900 -Job both"
$retry930Tr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Retry930Ps1`" -Attempt 930 -Job both"

function Ensure-DailyTask {
  param([string]$Name, [string]$Time, [string]$Tr)
  cmd /c "schtasks /Delete /TN `"$Name`" /F >nul 2>&1" | Out-Null
  schtasks /Create /TN $Name /TR $Tr /SC DAILY /ST $Time /RL LIMITED /F
  if ($LASTEXITCODE -ne 0) { throw "Failed to create task: $Name (exit $LASTEXITCODE)" }

  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -WakeToRun `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Set-ScheduledTask -TaskName $Name -Settings $settings | Out-Null
  Write-Host "OK $Name @ $Time" -ForegroundColor Green
}

# Primary punctual cloud dispatch (laptop-off path when gh auth works on this PC)
Ensure-DailyTask -Name 'RDG-Toast-BS-Daily' -Time '08:25' -Tr $dispatchTr

# Secondary local refresh → Firebase immediately
Ensure-DailyTask -Name 'RDG DJ FourVenues Daily 830' -Time '08:30' -Tr $morningTr

# Retries + local Outlook Forecast flash email (no Azure Mail.Send needed)
Ensure-DailyTask -Name 'RDG-Toast-BS-Retry-900' -Time '09:00' -Tr $retry900Tr
Ensure-DailyTask -Name 'RDG-Toast-BS-Retry-930' -Time '09:30' -Tr $retry930Tr

# Preferred names (optional — often Access Denied on locked-down PCs)
foreach ($pair in @(
  @{ Name = 'RDG Daily Cloud Dispatch 825'; Time = '08:25'; Tr = $dispatchTr },
  @{ Name = 'RDG Morning Refresh 830'; Time = '08:30'; Tr = $morningTr },
  @{ Name = 'RDG Daily Cloud Retry 900'; Time = '09:00'; Tr = $retry900Tr },
  @{ Name = 'RDG Daily Cloud Retry 930'; Time = '09:30'; Tr = $retry930Tr }
)) {
  cmd /c "schtasks /Create /TN `"$($pair.Name)`" /TR `"$($pair.Tr)`" /SC DAILY /ST $($pair.Time) /RL LIMITED /F >nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    try {
      $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 1)
      Set-ScheduledTask -TaskName $pair.Name -Settings $settings -ErrorAction SilentlyContinue | Out-Null
      Write-Host "Also registered preferred name: $($pair.Name)" -ForegroundColor Green
    } catch {
      Write-Host "Preferred name registered (settings skipped): $($pair.Name)" -ForegroundColor DarkGray
    }
  } else {
    Write-Host "Preferred name blocked (ok): $($pair.Name)" -ForegroundColor DarkGray
  }
}

Write-Host ''
Write-Host 'Verify:' -ForegroundColor Cyan
foreach ($Name in @('RDG-Toast-BS-Daily', 'RDG DJ FourVenues Daily 830', 'RDG-Toast-BS-Retry-900', 'RDG-Toast-BS-Retry-930')) {
  try {
    $t = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
    $info = $t | Get-ScheduledTaskInfo
    $s = $t.Settings
    Write-Host ("{0} | Next={1} | Wake={2} | DisallowBattery={3} | StopOnBattery={4}" -f `
      $Name, $info.NextRunTime, $s.WakeToRun, $s.DisallowStartIfOnBatteries, $s.StopIfGoingOnBatteries)
  } catch {
    Write-Host ("MISSING {0} - re-run this installer or add cron-job.org at that time" -f $Name) -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host 'Laptop-off primary: also configure cron-job.org — see CLOUD-SETUP.md' -ForegroundColor Yellow
Write-Host 'Done.' -ForegroundColor Green
