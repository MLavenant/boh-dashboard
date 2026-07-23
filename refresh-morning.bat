@echo off
REM Single 8:30 AM job: FourVenues (Integrations API) then Toast BS
cd /d "C:\Cursor\toast-mcp-server"
echo ===== MORNING start %DATE% %TIME% =====>> "C:\Cursor\toast-mcp-server\refresh-log-morning.txt"
node rdg-morning-refresh.cjs >> "C:\Cursor\toast-mcp-server\refresh-log-morning.txt" 2>&1
set ERR=%ERRORLEVEL%
if %ERR% NEQ 0 (
  echo ===== MORNING FAIL %DATE% %TIME% =====>> "C:\Cursor\toast-mcp-server\refresh-log-morning.txt"
) else (
  echo ===== MORNING OK %DATE% %TIME% =====>> "C:\Cursor\toast-mcp-server\refresh-log-morning.txt"
)
exit /b %ERR%
