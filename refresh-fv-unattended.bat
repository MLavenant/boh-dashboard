@echo off
REM Unattended FourVenues + Toast — no interactive login / Outlook required
cd /d "C:\Cursor\toast-mcp-server"
set FV_UNATTENDED=1
set FV_HEADLESS=1
echo ===== UNATTENDED FV start %DATE% %TIME% =====>> "C:\Cursor\toast-mcp-server\refresh-log-fv.txt"
node fv-refresh-unattended.cjs >> "C:\Cursor\toast-mcp-server\refresh-log-fv.txt" 2>&1
if errorlevel 1 (
  node fb-scrape-status.cjs fourvenues fail "Unattended FourVenues job failed"
  echo ===== UNATTENDED FV FAIL %DATE% %TIME% =====>> "C:\Cursor\toast-mcp-server\refresh-log-fv.txt"
) else (
  echo ===== UNATTENDED FV OK %DATE% %TIME% =====>> "C:\Cursor\toast-mcp-server\refresh-log-fv.txt"
)
