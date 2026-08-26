@echo off
cd /d C:\Cursor\boh-rdg-publish
echo === Prep stations scrape (manual) ===
echo Step 1: Toast login (complete Cloudflare / 2FA in Edge if prompted)
node toast-login-refresh.mjs
if errorlevel 1 exit /b 1
echo.
echo Step 2: Scrape Bulk Editor menus + prep stations (all venues)
node scrape-prep-stations-all.cjs
if errorlevel 1 exit /b 1
echo.
echo Step 3: Merge into item-station-map.json
node extract-item-stations.cjs
echo.
echo Step 4: Rebuild dashboard
node build-unified-v2.cjs
node pipeline-health.cjs
echo.
echo Done. See data\prep-stations-*.json and Assignment tab in dashboard.html
