Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c node ""C:\Cursor\toast-mcp-server\fv-refresh-all.cjs"" >> ""C:\Cursor\toast-mcp-server\refresh-log.txt"" 2>&1", 0, False
Set WshShell = Nothing
