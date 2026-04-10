# TodoAI

An AI-powered task management desktop app that uses Claude to decompose complex tasks into actionable subtasks, suggest new tasks based on your project context, and autonomously execute work.

## What it does

TodoAI helps developers and teams manage complex projects by combining traditional task management with AI capabilities:

- **AI Task Decomposition**: Select any task and let Claude break it down into concrete subtasks, with a preview step so you stay in control
- **Smart Suggestions**: Claude analyzes your existing tasks, projects, and local codebase to suggest what you should work on next
- **GoAI Mode**: Hand off a task to Claude — it launches an autonomous agent in your project directory that works through subtasks and marks them complete
- **Daily Planning**: Auto-generate an optimized daily schedule based on task priority, effort, and available time
- **Dependency Graph**: Visualize task relationships with an interactive graph, including triggers (when task A completes, task B starts)
- **Google Calendar Sync**: Create calendar events from tasks and keep them in sync

## Built with

- **Frontend**: React 18 + TypeScript, wrapped in [Tauri v2](https://v2.tauri.app/) for native desktop performance
- **Backend**: Python [FastAPI](https://fastapi.tiangolo.com/) with SQLAlchemy ORM and SQLite
- **AI**: [Claude](https://www.anthropic.com/claude) via Claude CLI — powers task decomposition, suggestions, and autonomous execution
- **UI Libraries**: React Flow (dependency graph), xterm.js (terminal), dnd-kit (drag & drop)

## Architecture

TodoAI runs as a desktop app with a local backend:

```
┌─────────────────────────────┐
│   Tauri Desktop App         │
│   React + TypeScript        │
│                             │
│  ┌───────┐  ┌────────────┐  │
│  │ Views │  │ AI Panel   │  │
│  │       │  │ Terminal   │  │
│  └───┬───┘  └─────┬──────┘  │
│      │            │          │
│      │   Tauri Commands      │
│      │   (exec_claude,       │
│      │    launch_goai)       │
└──────┼────────────┼──────────┘
       │            │
       ▼            ▼
┌─────────────────────────────┐
│   FastAPI Backend           │
│   Port 18427                │
│                             │
│  ┌──────────┐ ┌───────────┐ │
│  │ REST API │ │ WebSocket │ │
│  │ (tasks,  │ │ (terminal)│ │
│  │ projects)│ └─────┬─────┘ │
│  └────┬─────┘       │       │
│       │             │        │
│  ┌────▼─────────────▼─────┐ │
│  │  Claude CLI             │ │
│  │  (subprocess)           │ │
│  │  - Plan generation      │ │
│  │  - Task suggestions     │ │
│  │  - Context analysis     │ │
│  └─────────────────────────┘ │
│       │                      │
│  ┌────▼─────┐                │
│  │  SQLite  │                │
│  └──────────┘                │
└──────────────────────────────┘
```

Claude is integrated through the CLI as a subprocess. The backend builds rich context prompts that include your task hierarchy, project metadata, and local codebase structure (tech stack detection, README excerpts, directory trees). Responses are parsed as structured JSON for the preview/confirm workflow.

The Tauri frontend can also invoke Claude directly via native commands for the GoAI mode and interactive terminal.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Python](https://www.python.org/) 3.11+
- [Rust](https://www.rust-lang.org/tools/install) (for Tauri)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

### Installation

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
python run.py
```

**Frontend:**
```bash
cd app
npm install
npm run tauri dev
```

### Configuration

- Database is created automatically at `~/.todoai/todoai.db`
- Google Calendar integration (optional): place your OAuth credentials at `~/.todoai/google_credentials.json`

## License

[MIT](LICENSE)
