@echo off
REM Double-click this to refresh FourVenues Forecast → Firebase (all users see it).
REM Laptop must be ON. No GitHub secrets needed.
cd /d C:\Cursor\toast-mcp-server
set FV_UNATTENDED=1
echo.
echo Refreshing FourVenues Forecast...
node fv-refresh-unattended.cjs
echo.
if errorlevel 1 (
  echo FAILED — if login expired, run: node fv-relogin-save.cjs
  pause
  exit /b 1
)
echo DONE — open the DJ Dashboard Forecast / Sanity to confirm.
pause
