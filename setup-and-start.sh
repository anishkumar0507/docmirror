#!/bin/bash
set -e

echo "============================================"
echo " The Doc Mirror - Setup and Start"
echo "============================================"
echo ""

cd "$(dirname "$0")/dev-package"

echo "[1/2] Installing dependencies (this may take 2-3 minutes first time)..."
npm install

echo ""
echo "[2/2] Starting server..."
echo ""
echo "Open your browser at: http://localhost:3000"
echo "Press Ctrl+C to stop the server."
echo ""
node server.js
