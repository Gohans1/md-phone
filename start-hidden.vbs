' Starts the server with no console window.
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.bun\bin\bun.exe"" server.ts", 0, False
