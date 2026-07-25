@echo off
REM 8:30 AM local backup: FourVenues (Integrations API) then Toast BS → Firebase
set ROOT=%~dp0
cd /d "%ROOT%"
if not exist "%ROOT%logs" mkdir "%ROOT%logs"
echo ===== MORNING start %DATE% %TIME% =====>> "%ROOT%logs\refresh-morning.log"
node "%ROOT%rdg-morning-refresh.cjs" >> "%ROOT%logs\refresh-morning.log" 2>&1
set ERR=%ERRORLEVEL%
if %ERR% NEQ 0 (
  echo ===== MORNING FAIL %DATE% %TIME% =====>> "%ROOT%logs\refresh-morning.log"
) else (
  echo ===== MORNING OK %DATE% %TIME% =====>> "%ROOT%logs\refresh-morning.log"
)
exit /b %ERR%
