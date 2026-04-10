@echo off
echo Starting TodoAI development servers...

:: Start backend in a new window
start "TodoAI Backend" cmd /k "cd /d %~dp0backend && venv\Scripts\activate && python run.py"

:: Wait for backend to start
timeout /t 3 /nobreak >nul

:: Start Tauri app (includes Vite frontend)
cd /d "%~dp0app"
npm run tauri dev
