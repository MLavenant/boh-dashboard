Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
logDir = "C:\Cursor\toast-mcp-server\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
shell.Run "cmd /c C:\Cursor\toast-mcp-server\refresh-toast-live.bat", 0, True
