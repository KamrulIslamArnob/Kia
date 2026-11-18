@echo off
title HyperFrames Studio Hub
cd /d "%~dp0"

echo ===================================================
echo   HyperFrames Studio Hub (http://localhost:4400)
echo ===================================================

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4400 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo Studio Hub is already running. Opening browser...
  start "" "http://localhost:4400"
  exit /b 0
)

echo Starting Studio Hub server...
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" "http://localhost:4400""
node studio-hub\server.mjs
pause
