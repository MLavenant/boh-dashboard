@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set ERR=0

echo [%date% %time%] Starting BOH weekly auto-run >> auto-run.log 2>&1

:: 1) Refresh Toast Web Admin session (Edge). Cookies expire in ~2-4 days;
::    GitHub-hosted runners hit Cloudflare — laptop Edge refresh is the primary path.
echo [%date% %time%] Refreshing Toast session via Edge... >> auto-run.log 2>&1
node toast-login-refresh.mjs >> auto-run.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: toast-login-refresh.mjs failed >> auto-run.log 2>&1
  node fb-scrape-status.cjs bohWeekly fail "Toast login refresh failed on laptop Monday job" "{\"schedule\":\"Mon 8:30 AM ET laptop\"}" >> auto-run.log 2>&1
  exit /b 1
)
copy /Y toast-session.json "C:\Cursor\toast-mcp-server\toast-session.json" >nul 2>&1

:: 2) Fetch last full ISO week
echo [%date% %time%] weekly-save.js starting... >> auto-run.log 2>&1
node weekly-save.js >> auto-run.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] WARN: weekly-save.js exited non-zero — continuing with any venues that succeeded >> auto-run.log 2>&1
  set ERR=1
)

:: 3) Process any missing venue week JSON from raw kitchen files
node -e "const fs=require('fs'),path=require('path'),{execSync}=require('child_process');const root=path.join('data');const weeks=fs.readdirSync(root).filter(d=>/^\d{4}-W\d{2}$/.test(d)).sort();const w=weeks[weeks.length-1];if(!w)process.exit(0);console.log('Latest week dir',w);for(const v of ['claudie','casa_neos','ava_coconut_grove','ava_winter_park','mila']){const out=v+'-data-'+w+'.json';const kt=path.join(root,w,'kitchen-timing-'+v+'.json');if(fs.existsSync(kt)&&!fs.existsSync(out)){console.log('process',v,w);try{execSync('node process-venue-data.cjs '+v+' '+w,{stdio:'inherit'});}catch(e){console.error(e.message);process.exitCode=1;}}}" >> auto-run.log 2>&1

:: 4) Staffing (warn-only)
node weekly-staffing.cjs >> auto-run.log 2>&1
if errorlevel 1 echo [%date% %time%] WARN: weekly-staffing.cjs failed >> auto-run.log 2>&1

:: 5) Sold-item listings from local item-details
for %%V in (claudie casa_neos ava_coconut_grove ava_winter_park mila) do (
  node enrich-station-hour-items.cjs %%V >> auto-run.log 2>&1
)

:: 6) Health + rebuild + Firebase
node pipeline-health.cjs >> auto-run.log 2>&1
node build-unified-v2.cjs >> auto-run.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: build-unified-v2.cjs failed >> auto-run.log 2>&1
  exit /b 1
)

node boh-publish-firebase.cjs >> auto-run.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: Firebase publish failed >> auto-run.log 2>&1
  set ERR=1
)

:: 7) Keep GitHub Actions Toast secret fresh for cloud backup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare-boh-cloud-session.ps1" >> auto-run.log 2>&1
where gh >nul 2>&1
if not errorlevel 1 (
  powershell -NoProfile -Command "gh secret set TOAST_SESSION_GZIP_B64 --repo MLavenant/boh-dashboard --body (Get-Clipboard)" >> auto-run.log 2>&1
  echo [%date% %time%] Updated GitHub secret TOAST_SESSION_GZIP_B64 >> auto-run.log 2>&1
)

:: 8) Commit + push Pages
git add dashboard.html pipeline-health.json item-station-map.json *-data-*.json *-data.json process-venue-data.cjs weekly-save.js weekly-auto-run.bat enrich-station-hour-items.cjs toast-login-refresh.mjs 2>>auto-run.log
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "BOH weekly auto-update (laptop)" >> auto-run.log 2>&1
)
git fetch origin main >> auto-run.log 2>&1
git pull --rebase origin main >> auto-run.log 2>&1
git push origin HEAD:main >> auto-run.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: git push to main failed >> auto-run.log 2>&1
  set ERR=1
)

if %ERR% EQU 0 (
  node fb-scrape-status.cjs bohWeekly ok "BOH weekly laptop job succeeded" "{\"schedule\":\"Mon 8:30 AM ET laptop + Edge login\"}" >> auto-run.log 2>&1
  echo [%date% %time%] Live: https://mlavenant.github.io/boh-dashboard/dashboard.html >> auto-run.log 2>&1
  echo [%date% %time%] Weekly auto-run complete >> auto-run.log 2>&1
) else (
  node fb-scrape-status.cjs bohWeekly fail "BOH weekly laptop job finished with errors" "{\"schedule\":\"Mon 8:30 AM ET laptop\"}" >> auto-run.log 2>&1
  echo [%date% %time%] Weekly auto-run finished with errors ERR=%ERR% >> auto-run.log 2>&1
)

exit /b %ERR%
