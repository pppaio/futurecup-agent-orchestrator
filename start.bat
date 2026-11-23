@echo off
title Agent Orchestrator - One Click Start
cd /d "%~dp0agent-platform"

echo =============================================
echo   Agent Orchestrator - One Click Start
echo   No API key = demo mode, Fake LLM, zero cost
echo   Close this window to stop the server
echo =============================================

where node >nul 2>nul
if errorlevel 1 goto no-node

node -e "if(+process.versions.node.split('.')[0]<20)process.exit(1)" >nul 2>nul
if errorlevel 1 goto old-node

where npm >nul 2>nul
if errorlevel 1 goto no-npm

if exist node_modules goto skip-install
echo [1/4] First run: installing dependencies, 1-2 minutes...
call npm install
if errorlevel 1 goto install-failed
:skip-install

if exist "%LOCALAPPDATA%\ms-playwright" goto skip-browser
echo [2/4] First run: downloading headless Chromium, about 100MB, once...
call npx playwright install chromium
if errorlevel 1 goto browser-failed
:skip-browser

echo [3/4] Starting server. Frontend auto-builds on first run...
start "" http://localhost:3000
call npm run serve
goto eof

:no-node
echo [ERROR] Node.js not found.
echo Please install Node.js 20 or newer from https://nodejs.org/
echo Then run this script again.
pause
exit /b 1

:old-node
echo [ERROR] Node.js version must be 20 or newer. Current version:
node -v
echo Please upgrade from https://nodejs.org/
pause
exit /b 1

:no-npm
echo [ERROR] npm not found. Please reinstall Node.js from https://nodejs.org/
pause
exit /b 1

:install-failed
echo [ERROR] npm install failed. Check your network and try again.
pause
exit /b 1

:browser-failed
echo [ERROR] Chromium download failed. Check your network and try again.
pause
exit /b 1

:eof
echo.
echo Server stopped.
pause