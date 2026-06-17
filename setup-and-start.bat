@echo off
echo ============================================
echo  The Doc Mirror - Setup and Start
echo ============================================
echo.

cd /d "%~dp0dev-package"

echo [1/2] Installing dependencies (this may take 2-3 minutes first time)...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo ERROR: npm install failed. Make sure Node.js is installed.
    echo Download Node.js from: https://nodejs.org
    pause
    exit /b 1
)

echo.
echo [2/2] Starting server...
echo.
echo Open your browser at: http://localhost:3000
echo Press Ctrl+C to stop the server.
echo.
node server.js
pause
