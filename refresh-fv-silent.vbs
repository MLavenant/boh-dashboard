Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c C:\Cursor\toast-mcp-server\refresh-fv-daily.bat", 0, True
Set WshShell = Nothing
