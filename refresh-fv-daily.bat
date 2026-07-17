@echo off
REM Daily FourVenues Forecast refresh (8:30 AM Task: RDG DJ FourVenues Daily 830)
REM Requires: user logged in (Interactive), Outlook desktop open/available for Sales Report email,
REM           valid fv-final-session.json
cd /d "C:\Cursor\toast-mcp-server"
echo ===== FourVenues daily start %DATE% %TIME% =====>> "C:\Cursor\toast-mcp-server\refresh-log-fv.txt"
node fv-refresh-all.cjs >> "C:\Cursor\toast-mcp-server\refresh-log-fv.txt" 2>&1
if errorlevel 1 (
  node fb-scrape-status.cjs fourvenues fail "FourVenues job exited with error"
) else (
  echo ===== FourVenues daily OK %DATE% %TIME% =====>> "C:\Cursor\toast-mcp-server\refresh-log-fv.txt"
)
