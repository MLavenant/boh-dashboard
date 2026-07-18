Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c C:\Cursor\toast-mcp-server\refresh-fv-unattended.bat", 0, True
Set WshShell = Nothing
