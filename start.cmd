@echo off
cd /d "%~dp0"
if /i "%~1"=="beta" goto beta
:release
if exist "dist\release\launch.cmd" (
  call "dist\release\launch.cmd"
  exit /b
)
if exist "dist\release\luna-win32-x64\luna.exe" (
  start "" "dist\release\luna-win32-x64\luna.exe"
) else if /i "%~1"=="release" (
  echo Release build not found. Run npm run build:release first.
  exit /b 1
) else (
  call npm start
)
exit /b
:beta
if exist "dist\beta\launch.cmd" (
  call "dist\beta\launch.cmd"
  exit /b
)
if exist "dist\beta\luna-win32-x64\luna.exe" (
  start "" "dist\beta\luna-win32-x64\luna.exe"
) else (
  echo Beta build not found. Run npm run build:beta with a prerelease version first.
  exit /b 1
)
