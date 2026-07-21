@echo off
:: Always open the SHARED GitHub Pages dashboard (not local file://)
set STAMP=%DATE:~-4%%DATE:~4,2%%DATE:~7,2%-%TIME:~0,2%%TIME:~3,2%
set STAMP=%STAMP: =0%
start "" "https://mlavenant.github.io/boh-dashboard/dashboard.html?v=%STAMP%"
