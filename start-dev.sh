#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting TodoAI development servers..."

# Start backend
cd "$SCRIPT_DIR/backend"
if [ -d "venv/Scripts" ]; then
    source venv/Scripts/activate
else
    source venv/bin/activate
fi
python run.py &
BACKEND_PID=$!
echo "Backend started (PID: $BACKEND_PID)"

# Wait for backend
sleep 2

# Start Tauri app (includes Vite frontend)
cd "$SCRIPT_DIR/app"
npm run tauri dev &
FRONTEND_PID=$!
echo "Frontend started (PID: $FRONTEND_PID)"

# Trap to kill both on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

echo ""
echo "TodoAI running at http://localhost:1420"
echo "Backend API at http://127.0.0.1:18427/api"
echo "Press Ctrl+C to stop"

wait
