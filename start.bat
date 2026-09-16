@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo [MarkdownLite] Checking environment...

node --version >nul 2>&1
if errorlevel 1 (
    echo [MarkdownLite] ERROR: Node.js is not installed or not in PATH.
    echo [MarkdownLite] Please install Node.js first: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [MarkdownLite] node_modules not found, running npm install...
    call npm install
    if errorlevel 1 (
        echo [MarkdownLite] ERROR: npm install failed.
        pause
        exit /b 1
    )
)

echo [MarkdownLite] Starting server...
node server.js
