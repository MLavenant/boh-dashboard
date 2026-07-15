@echo off
cd /d C:\Cursor\toast-mcp-server
echo [%date% %time%] Starting weekly auto-run >> auto-run.log 2>&1
:: Delete stale session so intercept.js does a fresh login
if exist toast-session.json del toast-session.json >> auto-run.log 2>&1
:: Refresh Toast session via Playwright login
node intercept.js >> auto-run.log 2>&1
timeout /t 60 /nobreak
:: Fetch all venue data and rebuild dashboard
node weekly-save.js >> auto-run.log 2>&1
:: Push updated dashboard to GitHub (view-only share link via GitHub Pages)
git add dashboard.html *-data-*.json data/rolling.json 2>>auto-run.log
git commit -m "Weekly auto-update: dashboard + venue data" >> auto-run.log 2>&1
git push origin main >> auto-run.log 2>&1
echo [%date% %time%] Weekly auto-run complete >> auto-run.log 2>&1
