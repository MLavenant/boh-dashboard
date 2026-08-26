@echo off
setlocal
cd /d C:\Cursor\boh-rdg-publish
echo [%date% %time%] Starting monthly prep-stations scrape (all venues) >> monthly-prep.log 2>&1

:: Refresh Toast session only when missing (do not delete a valid session)
if not exist toast-session.json (
  echo No toast-session.json — running login refresh >> monthly-prep.log 2>&1
  node toast-login-refresh.mjs >> monthly-prep.log 2>&1
)

:: Scrape Claudie, AVA CG, AVA WP, Casa Neos, MILA from Bulk Editor
node scrape-prep-stations-all.cjs >> monthly-prep.log 2>&1
if errorlevel 1 goto fail

:: Rebuild item map (REF + Toast stations + chef target overrides)
node extract-item-stations.cjs >> monthly-prep.log 2>&1
if errorlevel 1 goto fail

:: Reprocess latest week + rebuild dashboard
for /f "delims=" %%W in ('dir /b /ad /o-n data\2026-W* 2^>nul ^| findstr /r "^2026-W"') do set LATEST_WEEK=%%W & goto gotweek
:gotweek
if defined LATEST_WEEK (
  for %%V in (claudie casa_neos ava_coconut_grove ava_winter_park mila) do node process-venue-data.cjs %%V %LATEST_WEEK% >> monthly-prep.log 2>&1
)
node build-unified-v2.cjs >> monthly-prep.log 2>&1
node pipeline-health.cjs >> monthly-prep.log 2>&1

git add dashboard.html pipeline-health.json item-station-map.json chef-target-overrides.json data/prep-stations-*.json >> monthly-prep.log 2>&1
git diff --cached --quiet >> monthly-prep.log 2>&1
if errorlevel 1 (
  git commit -m "Monthly prep-stations scrape: menu item station assignments" >> monthly-prep.log 2>&1
  git push origin main >> monthly-prep.log 2>&1
)
echo [%date% %time%] Monthly prep-stations scrape complete >> monthly-prep.log 2>&1
exit /b 0

:fail
echo [%date% %time%] Monthly prep-stations scrape FAILED >> monthly-prep.log 2>&1
exit /b 1
