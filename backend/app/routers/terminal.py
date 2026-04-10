import asyncio
import json
import os
import signal
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/terminal", tags=["terminal"])


class ClaudeProcess:
    """Manages a single claude CLI subprocess attached to a WebSocket."""

    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.proc: asyncio.subprocess.Process | None = None
        self._relay_task: asyncio.Task | None = None

    async def start(self) -> None:
        self.proc = await asyncio.create_subprocess_exec(
            "claude",
            "--verbose",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            # On Windows creationflags can't use os.setsid; skip process group
            **(_new_process_group_kwargs()),
        )
        self._relay_task = asyncio.create_task(self._relay_stdout())
        await self._send_event("started", {"pid": self.proc.pid})

    async def write(self, data: str) -> None:
        if self.proc and self.proc.stdin and not self.proc.stdin.is_closing():
            self.proc.stdin.write(data.encode())
            await self.proc.stdin.drain()

    async def kill(self) -> None:
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.terminate()
                try:
                    await asyncio.wait_for(self.proc.wait(), timeout=5)
                except asyncio.TimeoutError:
                    self.proc.kill()
            except ProcessLookupError:
                pass
        if self._relay_task and not self._relay_task.done():
            self._relay_task.cancel()
            try:
                await self._relay_task
            except asyncio.CancelledError:
                pass

    async def _relay_stdout(self) -> None:
        """Read subprocess stdout and forward to WebSocket."""
        assert self.proc and self.proc.stdout
        try:
            while True:
                chunk = await self.proc.stdout.read(4096)
                if not chunk:
                    break
                await self._send_event("output", {"data": chunk.decode(errors="replace")})
        except (asyncio.CancelledError, ConnectionError):
            pass
        finally:
            code = await self.proc.wait()
            try:
                await self._send_event("exited", {"code": code})
            except Exception:
                pass

    async def _send_event(self, event: str, payload: dict | None = None) -> None:
        msg = {"event": event, **(payload or {})}
        await self.ws.send_json(msg)


def _new_process_group_kwargs() -> dict:
    """Return platform-specific kwargs for subprocess creation."""
    if os.name == "nt":
        import subprocess as _sp
        return {"creationflags": _sp.CREATE_NEW_PROCESS_GROUP}
    return {"preexec_fn": os.setsid}


@router.websocket("/ws")
async def terminal_ws(ws: WebSocket):
    """
    WebSocket endpoint to pilot an interactive claude process.

    Client → Server messages (JSON):
        {"action": "start"}              – spawn the claude process
        {"action": "input", "data": "…"} – send text to stdin
        {"action": "kill"}               – terminate the process

    Server → Client messages (JSON):
        {"event": "started", "pid": 123}
        {"event": "output", "data": "…"}
        {"event": "exited", "code": 0}
        {"event": "error", "message": "…"}
    """
    await ws.accept()
    process = ClaudeProcess(ws)

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"event": "error", "message": "invalid JSON"})
                continue

            action = msg.get("action")

            if action == "start":
                if process.proc and process.proc.returncode is None:
                    await ws.send_json({"event": "error", "message": "process already running"})
                    continue
                try:
                    await process.start()
                except FileNotFoundError:
                    await ws.send_json({
                        "event": "error",
                        "message": "claude CLI not found – is it installed and on PATH?",
                    })
                except OSError as exc:
                    await ws.send_json({"event": "error", "message": str(exc)})

            elif action == "input":
                data = msg.get("data", "")
                if not process.proc or process.proc.returncode is not None:
                    await ws.send_json({"event": "error", "message": "no running process"})
                    continue
                await process.write(data)

            elif action == "kill":
                await process.kill()

            else:
                await ws.send_json({"event": "error", "message": f"unknown action: {action}"})

    except WebSocketDisconnect:
        pass
    finally:
        await process.kill()
