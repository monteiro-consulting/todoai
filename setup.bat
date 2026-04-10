@echo off
echo === TodoAI Setup (Windows) ===

:: Check prerequisites
where python >nul 2>&1 || (echo Python 3.12+ required. Install from python.org && exit /b 1)
where node >nul 2>&1 || (echo Node.js 20+ required. Install from nodejs.org && exit /b 1)
where npm >nul 2>&1 || (echo npm required && exit /b 1)

:: Create data directory
set DATA_DIR=%USERPROFILE%\.todoai
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
echo Data directory: %DATA_DIR%

:: Setup backend
echo.
echo === Setting up Backend ===
cd /d "%~dp0backend"
python -m venv venv
call venv\Scripts\activate.bat
pip install -r requirements.txt
echo Backend ready.

:: Setup MCP
echo.
echo === Setting up MCP Server ===
cd /d "%~dp0mcp"
pip install -r requirements.txt
echo MCP server ready.

:: Setup frontend
echo.
echo === Setting up Frontend ===
cd /d "%~dp0app"
call npm install
echo Frontend ready.

:: Check Rust
echo.
where cargo >nul 2>&1 && (
    echo Rust found. You can build Tauri with: cd app ^&^& npm run tauri build
) || (
    echo WARNING: Rust not found. Install from https://rustup.rs for Tauri builds.
    echo You can still run the app in dev mode without Tauri.
)

echo.
echo === Google Calendar (Optional) ===
echo 1. Go to https://console.cloud.google.com
echo 2. Create OAuth 2.0 Client ID (Desktop app)
echo 3. Download credentials.json to %DATA_DIR%\google_credentials.json
echo.

echo === Setup Complete ===
echo.
echo To start the app:
echo   1. Start backend:  cd backend ^&^& venv\Scripts\activate ^&^& python run.py
echo   2. Start frontend: cd app ^&^& npm run dev
echo   3. Open http://localhost:1420
echo.
echo Or with Tauri: cd app ^&^& npm run tauri dev

cd /d "%~dp0"
pause
