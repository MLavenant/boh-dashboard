@echo off
cd /d C:\Cursor\toast-mcp-server
echo Starting Assignment Toast refresh helper on http://127.0.0.1:3855
echo Keep this window open, then click "Refresh from Toast" in the dashboard Assignment tab.
node assignment-refresh-server.cjs
pause
