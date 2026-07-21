@echo off
setlocal EnableExtensions
cd /d C:\Cursor\toast-mcp-server
set ERR=0

echo [%date% %time%] Starting weekly auto-run >> auto-run.log 2>&1

:: Prefer existing Toast session (headless token refresh). Only force re-login if missing.
if not exist toast-session.json (
  echo [%date% %time%] No toast-session.json — interactive login via intercept.js >> auto-run.log 2>&1
  node intercept.js >> auto-run.log 2>&1
  if errorlevel 1 (
    echo [%date% %time%] ERROR: intercept.js failed >> auto-run.log 2>&1
    exit /b 1
  )
  timeout /t 30 /nobreak >nul
)

:: Fetch last full ISO week for all venues + rebuild processed JSON
node weekly-save.js >> auto-run.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: weekly-save.js failed >> auto-run.log 2>&1
  set ERR=1
)

:: Refresh static item-station map from Excel REF sheets when present
node extract-item-stations.cjs >> auto-run.log 2>&1

:: Sanity check
node pipeline-health.cjs >> auto-run.log 2>&1
if errorlevel 1 set ERR=1

:: Rebuild dashboard with health embedded
node build-unified-v2.cjs >> auto-run.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: build-unified-v2.cjs failed >> auto-run.log 2>&1
  exit /b 1
)

:: Push only if fetch/build succeeded
if %ERR% NEQ 0 (
  echo [%date% %time%] Skipping git push due to earlier errors >> auto-run.log 2>&1
  exit /b %ERR%
)

git add dashboard.html pipeline-health.json *-data-*.json data/rolling.json item-station-map.json data/2026-W* 2>>auto-run.log
git commit -m "Weekly auto-update: dashboard + venue data + health check" >> auto-run.log 2>&1
git push origin main >> auto-run.log 2>&1

echo [%date% %time%] Weekly auto-run complete >> auto-run.log 2>&1
exit /b 0
