@echo off
REM Toast LIVE night — safe to run every 30 min; script no-ops outside 11pm-3am ET
cd /d C:\Cursor\toast-mcp-server
node toast-live-night.cjs >> logs\toast-live-night.log 2>&1
