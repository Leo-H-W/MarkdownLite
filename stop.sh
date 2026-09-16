#!/usr/bin/env bash

echo "[MarkdownLite] Stopping background server..."

pkill -f "markdownlite.exe" 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true

echo "[MarkdownLite] Stopped."
