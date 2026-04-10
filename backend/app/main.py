import asyncio
import json
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse
from .database import init_db, engine
from .routers import projects, tasks, calendar, plan, audit, data_io, terminal

app = FastAPI(title="TodoAI", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Live sync event bus ---
_subscribers: list[asyncio.Queue] = []

def notify_change(entity_type: str, action: str, entity_id: str = ""):
    event = {"type": entity_type, "action": action, "id": entity_id, "ts": time.time()}
    for q in _subscribers:
        q.put_nowait(event)

app.state.notify_change = notify_change

@app.get("/api/events")
async def sse_events(request: Request):
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers.append(queue)

    async def stream():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield f": keepalive\n\n"
        finally:
            _subscribers.remove(queue)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })

app.include_router(projects.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(calendar.router, prefix="/api")
app.include_router(plan.router, prefix="/api")
app.include_router(audit.router, prefix="/api")
app.include_router(data_io.router, prefix="/api")
app.include_router(terminal.router, prefix="/api")


@app.on_event("startup")
def on_startup():
    init_db()
    # Migrate: add missing columns
    with engine.connect() as conn:
        import sqlalchemy
        # Migrate projects table
        proj_cols = [row[1] for row in conn.execute(sqlalchemy.text("PRAGMA table_info(projects)"))]
        if "local_path" not in proj_cols:
            conn.execute(sqlalchemy.text("ALTER TABLE projects ADD COLUMN local_path VARCHAR(1024)"))
            conn.commit()
        # Migrate tasks table
        result = conn.execute(sqlalchemy.text("PRAGMA table_info(tasks)"))
        columns = [row[1] for row in result]
        if "triggers_goai_task_id" not in columns:
            conn.execute(sqlalchemy.text("ALTER TABLE tasks ADD COLUMN triggers_goai_task_id VARCHAR(36) REFERENCES tasks(id)"))
            conn.commit()
        if "critical" not in columns:
            conn.execute(sqlalchemy.text("ALTER TABLE tasks ADD COLUMN critical BOOLEAN DEFAULT 0"))
            conn.commit()
        if "trigger_mode" not in columns:
            conn.execute(sqlalchemy.text("ALTER TABLE tasks ADD COLUMN trigger_mode VARCHAR(10) DEFAULT 'or'"))
            conn.commit()
        if "trigger_goai" not in columns:
            conn.execute(sqlalchemy.text("ALTER TABLE tasks ADD COLUMN trigger_goai BOOLEAN DEFAULT 0"))
            conn.commit()
        # Migrate old triggers_goai_task_id to new task_triggers table
        tables = conn.execute(sqlalchemy.text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
        table_names = [t[0] for t in tables]
        # Create task_dependencies table if missing
        if "task_dependencies" not in table_names:
            conn.execute(sqlalchemy.text(
                "CREATE TABLE task_dependencies ("
                "  task_id VARCHAR(36) NOT NULL REFERENCES tasks(id),"
                "  depends_on_id VARCHAR(36) NOT NULL REFERENCES tasks(id),"
                "  created_at DATETIME DEFAULT (datetime('now')),"
                "  PRIMARY KEY (task_id, depends_on_id)"
                ")"
            ))
            conn.commit()
        if "task_triggers" in table_names:
            old_links = conn.execute(sqlalchemy.text(
                "SELECT id, triggers_goai_task_id FROM tasks WHERE triggers_goai_task_id IS NOT NULL AND is_deleted = 0"
            )).fetchall()
            for source_id, target_id in old_links:
                existing = conn.execute(sqlalchemy.text(
                    "SELECT id FROM task_triggers WHERE source_task_id = :s AND target_task_id = :t"
                ), {"s": source_id, "t": target_id}).fetchone()
                if not existing:
                    import uuid
                    conn.execute(sqlalchemy.text(
                        "INSERT INTO task_triggers (id, source_task_id, target_task_id) VALUES (:id, :s, :t)"
                    ), {"id": str(uuid.uuid4()), "s": source_id, "t": target_id})
                    # Set trigger_goai on target since old system always sent to GoAi
                    conn.execute(sqlalchemy.text(
                        "UPDATE tasks SET trigger_goai = 1 WHERE id = :t"
                    ), {"t": target_id})
            conn.commit()


@app.get("/api/health")
def health():
    return {"status": "ok"}
