@echo off
REM FourVenues daily Forecast — Integrations API (same path as GitHub Actions)
REM No Playwright / Outlook / browser session required.
cd /d "C:\Cursor\toast-mcp-server"
echo ===== FV API start %DATE% %TIME% =====>> "C:\Cursor\toast-mcp-server\refresh-log-fv.txt"
node fv-refresh-api.cjs >> "C:\Cursor\toast-mcp-server\refresh-log-fv.txt" 2>&1
if errorlevel 1 (
  node fb-scrape-status.cjs fourvenues fail "FourVenues Integrations API job failed"
  echo ===== FV API FAIL %DATE% %TIME% =====>> "C:\Cursor\toast-mcp-server\refresh-log-fv.txt"
  exit /b 1
) else (
  echo ===== FV API OK %DATE% %TIME% =====>> "C:\Cursor\toast-mcp-server\refresh-log-fv.txt"
  exit /b 0
)
