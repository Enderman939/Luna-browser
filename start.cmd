@echo off
cd /d "%~dp0"
if exist "dist\compact\luna-win32-x64\luna.exe" (
  start "" "dist\compact\luna-win32-x64\luna.exe"
) else if exist "dist\luna-win32-x64\luna.exe" (
  start "" "dist\luna-win32-x64\luna.exe"
) else (
  call npm start
)
