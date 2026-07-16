@echo off
cd /d "C:\Cursor\toast-mcp-server"
node toast-monday-refresh.cjs >> "C:\Cursor\toast-mcp-server\refresh-log-toast.txt" 2>&1
if errorlevel 1 node fb-scrape-status.cjs toast fail "Toast Monday job exited with error"
