@echo off
cd /d "C:\Cursor\toast-mcp-server"
node fv-refresh-all.cjs >> "C:\Cursor\toast-mcp-server\refresh-log.txt" 2>&1
