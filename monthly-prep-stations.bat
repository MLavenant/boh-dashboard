@echo off
cd /d C:\Cursor\toast-mcp-server
echo [%date% %time%] Starting monthly prep-stations scrape (all venues) >> monthly-prep.log 2>&1
:: Fresh Toast login
if exist toast-session.json del toast-session.json >> monthly-prep.log 2>&1
node intercept.js >> monthly-prep.log 2>&1
timeout /t 60 /nobreak
:: Scrape Claudie, AVA CG, AVA WP, Casa Neos from Bulk Editor
node scrape-prep-stations-all.cjs >> monthly-prep.log 2>&1
:: Rebuild item map (REF + Toast stations + chef target overrides)
node extract-item-stations.cjs >> monthly-prep.log 2>&1
:: Rebuild dashboard
node build-unified-v2.cjs >> monthly-prep.log 2>&1
git add dashboard.html item-station-map.json chef-target-overrides.json data/prep-stations-*.json >> monthly-prep.log 2>&1
git commit -m "Monthly prep-stations scrape: Claudie, AVA CG, AVA WP, Casa Neos" >> monthly-prep.log 2>&1
git push origin main >> monthly-prep.log 2>&1
echo [%date% %time%] Monthly prep-stations scrape complete >> monthly-prep.log 2>&1
