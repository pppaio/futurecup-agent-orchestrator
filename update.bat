@echo off
title Agent Orchestrator - One Click Update
echo ============================================
echo   One-click update: download the latest code
echo   from GitHub without opening the website.
echo ============================================

where powershell >nul 2>nul
if errorlevel 1 goto no-ps

echo Downloading the latest version...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $zip=Join-Path $env:TEMP 'faq-agent-update.zip'; Invoke-WebRequest -Uri 'https://github.com/pppaio/futurecup-agent-orchestrator/archive/refs/heads/main.zip' -OutFile $zip; $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'; $dest=Join-Path ([Environment]::GetFolderPath('Desktop')) ('futurecup-agent-orchestrator-' + $stamp); Expand-Archive -Path $zip -DestinationPath $dest -Force; $inner=Join-Path $dest 'futurecup-agent-orchestrator-main'; if (Test-Path $inner) { explorer.exe $inner } else { explorer.exe $dest }"

if errorlevel 1 goto dl-failed
echo.
echo Done. A new folder just opened - double-click start.bat inside it.
pause
exit /b 0

:no-ps
echo [ERROR] PowerShell not found. Please run Windows Update and try again.
pause
exit /b 1

:dl-failed
echo [ERROR] Download failed. Check your network and try again later.
pause
exit /b 1
