"""
Plan generator service: decomposes a task into subtasks using Claude CLI.
This implements the "plan mode" — generating structured subtasks before coding.
Same approach as the Tauri exec_claude command: subprocess with stdin piping.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
from sqlalchemy.orm import Session
from ..models.task import Task
from ..services.audit import log_action


def _build_plan_prompt(
    task: Task,
    project_name: str | None = None,
    project_notes: str | None = None,
    local_path: str | None = None,
) -> str:
    """Build the prompt for Claude to decompose a task into subtasks."""
    prompt = (
        "Tu es un assistant de planification de projet. "
        "On te donne une tache parente, et tu dois la decomposer en sous-taches concretes et actionnables.\n\n"
    )

    prompt += "# Tache parente\n"
    prompt += f'- Titre: "{task.title}"\n'
    if task.notes:
        prompt += f"- Context: {task.notes}\n"
    if task.tags:
        tags = json.loads(task.tags) if isinstance(task.tags, str) else task.tags
        if tags:
            prompt += f"- Tags: {', '.join(tags)}\n"
    prompt += f"- Impact: {task.impact}/5 | Effort: {task.effort}/5 | Estimate: {task.estimate_min}min\n"

    # Include existing subtasks to avoid duplication
    existing_subtasks = [
        st for st in (task.subtasks or [])
        if not st.is_deleted and st.status not in ("done", "archived")
    ]
    if existing_subtasks:
        prompt += "\n# Sous-taches existantes (ne pas dupliquer)\n"
        for st in existing_subtasks:
            prompt += f'- "{st.title}" ({st.status})\n'

    if project_name:
        prompt += f"\nProjet: {project_name}\n"
        if project_notes:
            prompt += f"Context du projet:\n{project_notes}\n"

    if local_path:
        from .suggestions import _build_local_context
        local_ctx = _build_local_context(local_path)
        if local_ctx:
            prompt += local_ctx

    prompt += "\n# Instructions\n"
    prompt += "Decompose cette tache en 3-8 sous-taches concretes. Chaque sous-tache doit:\n"
    prompt += "- Etre une unite de travail clairement definie et actionnable\n"
    prompt += "- Avoir un titre court et precis (max 80 chars)\n"
    prompt += "- Avoir une description (notes) de 1-2 phrases expliquant quoi faire\n"
    prompt += "- Avoir des estimations realistes (impact 1-5, effort 1-5, estimate_min 5-120)\n"
    prompt += "- Etre dans l'ordre logique d'execution\n\n"
    prompt += 'Reponds UNIQUEMENT avec un JSON valide (sans markdown, sans backticks) au format:\n'
    prompt += '[{"title": "...", "notes": "...", "impact": 3, "effort": 2, "estimate_min": 30, "tags": ["..."]}]\n'

    return prompt


def _find_claude_cmd() -> str:
    """Find the claude CLI executable path."""
    found = shutil.which("claude")
    if found:
        return found
    found = shutil.which("claude.cmd")
    if found:
        return found
    npm_path = os.path.join(os.environ.get("APPDATA", ""), "npm", "claude.cmd")
    if os.path.isfile(npm_path):
        return npm_path
    return "claude"


def _call_claude(prompt: str) -> str:
    """
    Call Claude CLI via subprocess with stdin piping.
    Same approach as the Tauri exec_claude Rust command.
    """
    claude_cmd = _find_claude_cmd()

    # Remove all Claude Code session env vars to avoid nested session errors
    env = {
        k: v for k, v in os.environ.items()
        if k not in ("CLAUDECODE", "CLAUDE_CODE_SESSION", "CLAUDE_CODE_ENTRYPOINT")
    }

    proc = subprocess.Popen(
        [claude_cmd, "-p", "--output-format", "text"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    stdout, stderr = proc.communicate(input=prompt.encode("utf-8"), timeout=120)

    if proc.returncode != 0 and not stdout.strip():
        raise RuntimeError(f"Claude CLI failed (code {proc.returncode}): {stderr.decode()[:500]}")

    return stdout.decode("utf-8").strip()


def _parse_subtasks(response: str) -> list[dict]:
    """Parse Claude's JSON response into a list of subtask dicts."""
    text = response.strip()
    # Handle backtick-wrapped JSON
    match = re.search(r'\[[\s\S]*\]', text)
    if match:
        text = match.group(0)
    subtasks = json.loads(text)
    if not isinstance(subtasks, list) or len(subtasks) == 0:
        raise ValueError("Claude returned no subtasks")
    return subtasks


def generate_plan_preview(
    task: Task,
    project_name: str | None = None,
    project_notes: str | None = None,
    local_path: str | None = None,
) -> list[dict]:
    """
    Phase 1: Generate subtask proposals using Claude CLI.
    Returns a list of dicts (not persisted) for user review.
    """
    prompt = _build_plan_prompt(task, project_name, project_notes, local_path)
    response = _call_claude(prompt)
    parsed = _parse_subtasks(response)

    proposals = []
    for st_data in parsed:
        tags = st_data.get("tags", [])
        if isinstance(tags, str):
            tags = [tags]
        proposals.append({
            "title": st_data.get("title", "Sans titre")[:500],
            "notes": st_data.get("notes"),
            "impact": max(1, min(5, st_data.get("impact", 3))),
            "effort": max(1, min(5, st_data.get("effort", 3))),
            "estimate_min": max(5, min(480, st_data.get("estimate_min", 30))),
            "tags": tags if isinstance(tags, list) else [],
        })

    return proposals


def confirm_plan_subtasks(
    db: Session,
    task: Task,
    subtasks_data: list[dict],
) -> list[Task]:
    """
    Phase 2: Create the confirmed subtasks in the database.
    Called after the user has reviewed/edited the plan preview.
    """
    existing_count = len([
        st for st in (task.subtasks or [])
        if not st.is_deleted and st.status not in ("done", "archived")
    ])

    created = []
    for i, st_data in enumerate(subtasks_data):
        tags = st_data.get("tags", [])
        if isinstance(tags, str):
            tags = [tags]

        subtask = Task(
            title=st_data["title"][:500],
            notes=st_data.get("notes"),
            parent_task_id=task.id,
            project_id=task.project_id,
            impact=max(1, min(5, st_data.get("impact", 3))),
            effort=max(1, min(5, st_data.get("effort", 3))),
            estimate_min=max(5, min(480, st_data.get("estimate_min", 30))),
            tags=tags if isinstance(tags, list) else [],
            position=existing_count + i,
        )
        subtask.compute_score()
        db.add(subtask)
        db.flush()
        log_action(db, "create", "task", subtask.id, {"source": "plan", "parent": task.id})
        created.append(subtask)

    return created


def generate_plan_for_task(
    db: Session,
    task: Task,
    project_name: str | None = None,
    project_notes: str | None = None,
    local_path: str | None = None,
) -> list[Task]:
    """
    Legacy: Generate and immediately create subtasks (no preview).
    Combines preview + confirm in one step.
    """
    proposals = generate_plan_preview(task, project_name, project_notes, local_path)
    return confirm_plan_subtasks(db, task, proposals)
