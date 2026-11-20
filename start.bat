@echo off
chcp 65001 >nul
title Agent 编排平台 - 一键启动
cd /d "%~dp0agent-platform"

echo ============================================
echo   Agent 编排平台 一键启动
echo   无 API Key 时自动进入演示模式（Fake LLM，零成本）
echo   关闭本窗口即停止服务
echo ============================================

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。请先安装 Node.js 20 或更高版本：
  echo   https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/3] 首次运行，安装依赖（约 1-2 分钟）...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

if not exist "%LOCALAPPDATA%\ms-playwright" (
  echo [2/3] 首次运行，下载无头浏览器 Chromium（约 100MB，仅一次）...
  call npx playwright install chromium
  if errorlevel 1 (
    echo [错误] 浏览器下载失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo [3/3] 启动服务...
start "" http://localhost:3000
call npm run serve

pause
