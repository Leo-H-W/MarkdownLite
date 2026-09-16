@echo off
chcp 65001 >nul

echo [MarkdownLite] Stopping background server...
taskkill /F /IM markdownlite.exe 2>nul
taskkill /F /IM node.exe 2>nul

echo [MarkdownLite] Stopped.
pause
