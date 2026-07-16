@echo off
cd /d "C:\Cursor\toast-mcp-server"
node fv-refresh-all.cjs >> "C:\Cursor\toast-mcp-server\refresh-log-fv.txt" 2>&1
if errorlevel 1 node fb-scrape-status.cjs fourvenues fail "FourVenues job exited with error"
