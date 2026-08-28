@echo off
REM ONE-TIME Casa Neos Ticket Details backfill (same Toast CSV export as weekly-save.js)
REM 1) Refresh session:  node intercept.js
REM 2) Run this:         backfill-casa-neos.bat
REM Optional:            backfill-casa-neos.bat --skip-existing
REM Optional:            backfill-casa-neos.bat --week 2026-W05

cd /d "%~dp0"
set BOH_ROOT=%~dp0
set TOAST_SESSION_FILE=%~dp0toast-session.json

if not exist "%TOAST_SESSION_FILE%" (
  echo Missing toast-session.json
  echo Run: node intercept.js
  exit /b 1
)

node backfill-casa-neos-tickets.mjs %*
if errorlevel 1 exit /b 1
echo.
echo When status says COMPLETE, start Casa Neos Time Entries week-to-week.
pause
