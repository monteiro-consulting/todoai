#!/usr/bin/env bash
set -euo pipefail

echo "=== TodoAI Setup ==="

# Detect OS
OS="$(uname -s)"
echo "Detected OS: $OS"

# Check prerequisites
command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1 || { echo "Python 3.12+ required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js 20+ required"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm required"; exit 1; }

PYTHON=$(command -v python3 2>/dev/null || command -v python)
echo "Using Python: $PYTHON"

# Create data directory
DATA_DIR="$HOME/.todoai"
mkdir -p "$DATA_DIR"
echo "Data directory: $DATA_DIR"

# Setup backend
echo ""
echo "=== Setting up Backend ==="
cd "$(dirname "$0")/backend"
$PYTHON -m venv venv
if [ "$OS" = "MINGW64_NT"* ] || [ "$OS" = "MSYS_NT"* ] || [ -d "venv/Scripts" ]; then
    source venv/Scripts/activate
else
    source venv/bin/activate
fi
pip install -r requirements.txt
echo "Backend ready."

# Setup MCP
echo ""
echo "=== Setting up MCP Server ==="
cd "$(dirname "$0")/mcp"
pip install -r requirements.txt
echo "MCP server ready."

# Setup frontend
echo ""
echo "=== Setting up Frontend ==="
cd "$(dirname "$0")/app"
npm install
echo "Frontend ready."

# Check Rust/Tauri
echo ""
if command -v cargo >/dev/null 2>&1; then
    echo "Rust found. You can build Tauri with: cd app && npm run tauri build"
else
    echo "WARNING: Rust not found. Install from https://rustup.rs for Tauri builds."
    echo "You can still run the app in dev mode (backend + React) without Tauri."
fi

# Google Calendar setup hint
echo ""
echo "=== Google Calendar (Optional) ==="
echo "1. Go to https://console.cloud.google.com"
echo "2. Create OAuth 2.0 Client ID (Desktop app)"
echo "3. Download credentials.json to $DATA_DIR/google_credentials.json"
echo ""

# Claude Desktop config hint
echo "=== Claude Desktop MCP Config ==="
echo "Add to your Claude Desktop config (claude_desktop_config.json):"
echo ""
cat "$(dirname "$0")/claude_desktop_config.json"
echo ""

echo "=== Setup Complete ==="
echo ""
echo "To start the app:"
echo "  1. Start backend:  cd backend && source venv/bin/activate && python run.py"
echo "  2. Start frontend: cd app && npm run dev"
echo "  3. Open http://localhost:1420"
echo ""
echo "Or with Tauri: cd app && npm run tauri dev"
