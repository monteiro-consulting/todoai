import json
import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

BACKEND = "http://127.0.0.1:18427/api"
app = Server("todoai-mcp")
client = httpx.Client(base_url=BACKEND, timeout=30)


def _call(method: str, path: str, body: dict | None = None, params: dict | None = None) -> dict:
    if method == "GET":
        r = client.get(path, params=params)
    elif method == "POST":
        r = client.post(path, json=body)
    elif method == "PATCH":
        r = client.patch(path, json=body)
    elif method == "DELETE":
        r = client.delete(path)
    else:
        raise ValueError(f"Unknown method {method}")
    r.raise_for_status()
    if r.status_code == 204:
        return {"ok": True}
    return r.json()


@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="project_list",
            description="List all projects",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="project_create",
            description="Create a new project",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Project name"},
                    "color": {"type": "string", "description": "Hex color, e.g. #6366f1"},
                },
                "required": ["name"],
            },
        ),
        Tool(
            name="task_list",
            description="List tasks, optionally filtered by project_id, status, parent_task_id",
            inputSchema={
                "type": "object",
                "properties": {
                    "project_id": {"type": "string"},
                    "status": {"type": "string", "enum": ["open", "waiting", "in_progress", "goai", "done", "archived"]},
                    "parent_task_id": {"type": "string"},
                },
            },
        ),
        Tool(
            name="task_create",
            description="Create a single task",
            inputSchema={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "project_id": {"type": "string"},
                    "parent_task_id": {"type": "string"},
                    "notes": {"type": "string"},
                    "due_at": {"type": "string", "description": "ISO datetime"},
                    "impact": {"type": "integer", "minimum": 1, "maximum": 5},
                    "effort": {"type": "integer", "minimum": 1, "maximum": 5},
                    "priority": {"type": "integer", "minimum": 1, "maximum": 5},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "estimate_min": {"type": "integer"},
                },
                "required": ["title"],
            },
        ),
        Tool(
            name="task_bulk_create",
            description="Create multiple tasks at once (max 50)",
            inputSchema={
                "type": "object",
                "properties": {
                    "tasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "project_id": {"type": "string"},
                                "impact": {"type": "integer"},
                                "effort": {"type": "integer"},
                                "tags": {"type": "array", "items": {"type": "string"}},
                                "estimate_min": {"type": "integer"},
                            },
                            "required": ["title"],
                        },
                    }
                },
                "required": ["tasks"],
            },
        ),
        Tool(
            name="task_update",
            description="Update a task's fields. Before setting status to in_progress or goai, call task_auto_plan first to ensure the task has subtasks.",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "title": {"type": "string"},
                    "notes": {"type": "string"},
                    "status": {"type": "string", "enum": ["open", "waiting", "in_progress", "goai", "done", "archived"]},
                    "due_at": {"type": "string"},
                    "impact": {"type": "integer", "minimum": 1, "maximum": 5},
                    "effort": {"type": "integer", "minimum": 1, "maximum": 5},
                    "priority": {"type": "integer", "minimum": 1, "maximum": 5},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "estimate_min": {"type": "integer"},
                    "project_id": {"type": "string"},
                },
                "required": ["task_id"],
            },
        ),
        Tool(
            name="task_complete",
            description="Mark a task as done",
            inputSchema={
                "type": "object",
                "properties": {"task_id": {"type": "string"}},
                "required": ["task_id"],
            },
        ),
        Tool(
            name="task_delete",
            description="Soft-delete a task",
            inputSchema={
                "type": "object",
                "properties": {"task_id": {"type": "string"}},
                "required": ["task_id"],
            },
        ),
        Tool(
            name="task_move",
            description="Move a task to a different project or parent",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "project_id": {"type": "string"},
                    "parent_task_id": {"type": "string"},
                    "position": {"type": "integer"},
                },
                "required": ["task_id"],
            },
        ),
        Tool(
            name="task_auto_plan",
            description="Generate subtasks (plan) for a task automatically. Skips if the task already has active subtasks. Always call this before setting a task to in_progress or goai status.",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "description": "The task ID to generate a plan for"},
                    "project_name": {"type": "string", "description": "Optional project name for context"},
                    "project_notes": {"type": "string", "description": "Optional project notes for context"},
                },
                "required": ["task_id"],
            },
        ),
        Tool(
            name="plan_today_generate",
            description="Generate an optimized plan for today",
            inputSchema={
                "type": "object",
                "properties": {
                    "available_minutes": {"type": "integer", "default": 480},
                    "focus_project_id": {"type": "string"},
                },
            },
        ),
        Tool(
            name="calendar_agenda_read",
            description="Read Google Calendar agenda for a date range",
            inputSchema={
                "type": "object",
                "properties": {
                    "start": {"type": "string", "description": "ISO datetime"},
                    "end": {"type": "string", "description": "ISO datetime"},
                    "calendar_id": {"type": "string", "default": "primary"},
                },
                "required": ["start", "end"],
            },
        ),
        Tool(
            name="calendar_event_create",
            description="Create a Google Calendar event linked to a task",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "start_at": {"type": "string"},
                    "end_at": {"type": "string"},
                    "calendar_id": {"type": "string", "default": "primary"},
                },
                "required": ["task_id", "start_at", "end_at"],
            },
        ),
        Tool(
            name="calendar_event_update",
            description="Update a calendar event linked to a task",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "start_at": {"type": "string"},
                    "end_at": {"type": "string"},
                },
                "required": ["task_id"],
            },
        ),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    try:
        result = _dispatch(name, arguments)
        return [TextContent(type="text", text=json.dumps(result, default=str, indent=2))]
    except httpx.HTTPStatusError as e:
        return [TextContent(type="text", text=f"Error {e.response.status_code}: {e.response.text}")]
    except Exception as e:
        return [TextContent(type="text", text=f"Error: {str(e)}")]


def _dispatch(name: str, args: dict) -> dict:
    if name == "project_list":
        return _call("GET", "/projects")
    elif name == "project_create":
        return _call("POST", "/projects", body=args)
    elif name == "task_list":
        params = {k: v for k, v in args.items() if v is not None}
        return _call("GET", "/tasks", params=params)
    elif name == "task_create":
        return _call("POST", "/tasks", body=args)
    elif name == "task_bulk_create":
        return _call("POST", "/tasks/bulk", body=args)
    elif name == "task_update":
        task_id = args.pop("task_id")
        return _call("PATCH", f"/tasks/{task_id}", body=args)
    elif name == "task_complete":
        return _call("POST", f"/tasks/{args['task_id']}/complete")
    elif name == "task_delete":
        return _call("DELETE", f"/tasks/{args['task_id']}")
    elif name == "task_auto_plan":
        task_id = args.pop("task_id")
        body = {k: v for k, v in args.items() if v is not None}
        return _call("POST", f"/tasks/{task_id}/auto-plan", body=body)
    elif name == "task_move":
        task_id = args.pop("task_id")
        return _call("POST", f"/tasks/{task_id}/move", params=args)
    elif name == "plan_today_generate":
        return _call("POST", "/plan/today", body=args)
    elif name == "calendar_agenda_read":
        return _call("GET", "/calendar/agenda", params=args)
    elif name == "calendar_event_create":
        return _call("POST", "/calendar/events", body=args)
    elif name == "calendar_event_update":
        task_id = args.pop("task_id")
        return _call("PATCH", f"/calendar/events/{task_id}", body=args)
    else:
        raise ValueError(f"Unknown tool: {name}")


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
