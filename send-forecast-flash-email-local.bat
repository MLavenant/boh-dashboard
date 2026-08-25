@echo off
REM Local Forecast flash email via Outlook (no Azure Mail.Send).
REM Called at 9:00 / 9:30 after cloud dispatch. PC must be on; Outlook profile signed in.
cd /d "%~dp0"
if not exist logs mkdir logs
set FORECAST_EMAIL_VIA=outlook
if "%FORECAST_EMAIL_ATTEMPT%"=="" set FORECAST_EMAIL_ATTEMPT=auto
echo ===== Forecast email local start %DATE% %TIME% attempt=%FORECAST_EMAIL_ATTEMPT% =====>> logs\forecast-email-local.txt
node send-forecast-flash-email.cjs >> logs\forecast-email-local.txt 2>&1
set ERR=%ERRORLEVEL%
echo ===== Forecast email local end %DATE% %TIME% exit=%ERR% =====>> logs\forecast-email-local.txt
exit /b %ERR%
