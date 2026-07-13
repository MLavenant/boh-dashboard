@echo off
cd /d C:\Cursor\toast-mcp-server
echo [%date% %time%] Starting weekly auto-run >> auto-run.log 2>&1
node intercept.js >> auto-run.log 2>&1
timeout /t 60 /nobreak
node weekly-save.js >> auto-run.log 2>&1
echo [%date% %time%] Weekly auto-run complete >> auto-run.log 2>&1
