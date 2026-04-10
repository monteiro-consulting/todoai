"""
Task suggestion service: analyzes existing tasks and projects to suggest new tasks.
Uses Claude CLI to generate intelligent suggestions based on context.
Same approach as the Tauri exec_claude command: subprocess with stdin piping.
"""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from sqlalchemy.orm import Session
from ..models.task import Task
from ..models.project import Project


# Directories to always skip when scanning a local project
_IGNORED_DIRS = {
    "node_modules", ".git", ".svn", ".hg", "venv", ".venv", "env", ".env",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    ".tox", ".nox", "dist", "build", ".next", ".nuxt", ".output",
    "target", "bin", "obj", ".idea", ".vscode", ".DS_Store",
    "coverage", ".turbo", ".parcel-cache", "vendor",
}

# Files that reveal the tech stack or are especially informative
_KEY_FILES = {
    "package.json", "tsconfig.json", "vite.config.ts", "vite.config.js",
    "next.config.js", "next.config.mjs", "nuxt.config.ts",
    "requirements.txt", "pyproject.toml", "setup.py", "setup.cfg",
    "Pipfile", "poetry.lock", "Cargo.toml", "go.mod", "go.sum",
    "Gemfile", "composer.json", "pom.xml", "build.gradle", "build.gradle.kts",
    "Makefile", "CMakeLists.txt", "Dockerfile", "docker-compose.yml",
    "docker-compose.yaml", ".env.example", "tailwind.config.js",
    "tailwind.config.ts", "webpack.config.js", "rollup.config.js",
    "jest.config.js", "vitest.config.ts", ".eslintrc.json", ".prettierrc",
    "manage.py", "app.py", "main.py", "index.ts", "index.js",
}

# Mapping: marker file -> detected technology
_TECH_MARKERS: dict[str, list[str]] = {
    "package.json": ["Node.js"],
    "tsconfig.json": ["TypeScript"],
    "vite.config.ts": ["Vite"],
    "vite.config.js": ["Vite"],
    "next.config.js": ["Next.js"],
    "next.config.mjs": ["Next.js"],
    "nuxt.config.ts": ["Nuxt"],
    "requirements.txt": ["Python"],
    "pyproject.toml": ["Python"],
    "Pipfile": ["Python", "Pipenv"],
    "Cargo.toml": ["Rust"],
    "go.mod": ["Go"],
    "Gemfile": ["Ruby"],
    "composer.json": ["PHP"],
    "pom.xml": ["Java", "Maven"],
    "build.gradle": ["Java/Kotlin", "Gradle"],
    "build.gradle.kts": ["Kotlin", "Gradle"],
    "Dockerfile": ["Docker"],
    "docker-compose.yml": ["Docker Compose"],
    "docker-compose.yaml": ["Docker Compose"],
    "tailwind.config.js": ["Tailwind CSS"],
    "tailwind.config.ts": ["Tailwind CSS"],
    "manage.py": ["Django"],
}


def scan_local_path(path: str, max_depth: int = 3) -> dict:
    """Scan a local project directory and return a structured summary.

    Args:
        path: Absolute path to the project root.
        max_depth: How many directory levels to traverse (default 3).

    Returns a dict with:
        - ``tree``: list of relative path strings (files and dirs)
        - ``key_files``: list of important / marker files found
        - ``readme``: content of the first README found (truncated to 2000 chars), or None
        - ``technologies``: deduplicated list of detected tech names
        - ``summary``: short human-readable text block combining the above
    """
    root = Path(path)
    if not root.is_dir():
        return {
            "tree": [],
            "key_files": [],
            "readme": None,
            "technologies": [],
            "summary": f"Le chemin '{path}' n'existe pas ou n'est pas un dossier.",
        }

    tree: list[str] = []
    key_files: list[str] = []
    readme_content: str | None = None
    technologies: set[str] = set()

    def _walk(current: Path, depth: int) -> None:
        nonlocal readme_content
        if depth > max_depth:
            return
        try:
            entries = sorted(current.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            return

        for entry in entries:
            rel = entry.relative_to(root).as_posix()

            if entry.is_dir():
                if entry.name in _IGNORED_DIRS:
                    continue
                tree.append(rel + "/")
                _walk(entry, depth + 1)
            else:
                tree.append(rel)
                name_lower = entry.name.lower()

                # Detect key files
                if entry.name in _KEY_FILES:
                    key_files.append(rel)

                # Detect technologies
                if entry.name in _TECH_MARKERS:
                    technologies.update(_TECH_MARKERS[entry.name])

                # Grab first README
                if readme_content is None and name_lower.startswith("readme"):
                    try:
                        readme_content = entry.read_text(encoding="utf-8", errors="replace")[:2000]
                    except (OSError, UnicodeDecodeError):
                        pass

                # Extra tech detection from extensions (only at root level)
                if depth == 1:
                    ext = entry.suffix.lower()
                    if ext in (".py",):
                        technologies.add("Python")
                    elif ext in (".rs",):
                        technologies.add("Rust")
                    elif ext in (".go",):
                        technologies.add("Go")
                    elif ext in (".java",):
                        technologies.add("Java")
                    elif ext in (".rb",):
                        technologies.add("Ruby")

    _walk(root, 1)

    # Enrich from package.json if present
    pkg_json_path = root / "package.json"
    if pkg_json_path.is_file():
        try:
            pkg = json.loads(pkg_json_path.read_text(encoding="utf-8"))
            all_deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            for dep, techs in {
                "react": ["React"],
                "vue": ["Vue"],
                "svelte": ["Svelte"],
                "angular": ["Angular"],
                "@angular/core": ["Angular"],
                "express": ["Express"],
                "fastify": ["Fastify"],
                "electron": ["Electron"],
                "@tauri-apps/api": ["Tauri"],
                "tailwindcss": ["Tailwind CSS"],
                "prisma": ["Prisma"],
                "drizzle-orm": ["Drizzle"],
            }.items():
                if dep in all_deps:
                    technologies.update(techs)
        except (OSError, json.JSONDecodeError):
            pass

    tech_list = sorted(technologies)

    # Build human-readable summary
    lines: list[str] = []
    lines.append(f"Projet: {root.name}")
    if tech_list:
        lines.append(f"Technologies: {', '.join(tech_list)}")
    lines.append(f"Fichiers/dossiers scannes: {len(tree)}")
    if key_files:
        lines.append(f"Fichiers cles: {', '.join(key_files[:15])}")
    if readme_content:
        lines.append(f"README (extrait):\n{readme_content[:500]}")

    return {
        "tree": tree,
        "key_files": key_files,
        "readme": readme_content,
        "technologies": tech_list,
        "summary": "\n".join(lines),
    }


_LOCAL_CONTEXT_BUDGET = 1000  # max chars for the local context section


def _build_local_context(local_path: str) -> str:
    """Build a compact 'Contexte local du projet' section for the suggestion prompt.

    Combines directory tree, detected stack, and README excerpt,
    trimmed to stay within ~_LOCAL_CONTEXT_BUDGET characters.
    """
    from .stack_detector import detect_stack

    try:
        scan = scan_local_path(local_path, max_depth=2)
    except Exception:
        scan = None

    try:
        stack = detect_stack(local_path)
    except Exception:
        stack = None

    has_scan = scan and scan.get("tree")
    has_stack = stack and stack.get("primary_language", "unknown") != "unknown"
    has_scan_tech = scan and scan.get("technologies")
    has_readme = scan and scan.get("readme")

    if not has_scan and not has_stack:
        return ""

    parts: list[str] = ["\n# Contexte local du projet\n"]

    # 1. Stack technique (compact)
    if has_stack:
        stack_line = f"Stack: {stack['primary_language']}"
        if stack.get("frameworks"):
            stack_line += f" | Frameworks: {', '.join(stack['frameworks'])}"
        if stack.get("project_types"):
            stack_line += f" | Type: {', '.join(stack['project_types'])}"
        parts.append(stack_line + "\n")
        extras: list[str] = []
        for key, label in [
            ("build_tools", "Build"),
            ("test_tools", "Tests"),
            ("orm_db", "ORM/DB"),
            ("infrastructure", "Infra"),
        ]:
            if stack.get(key):
                extras.append(f"{label}: {', '.join(stack[key])}")
        if extras:
            parts.append(" | ".join(extras) + "\n")
    elif has_scan_tech:
        # Fallback: use technologies detected by scan_local_path (handles monorepos)
        parts.append(f"Technologies: {', '.join(scan['technologies'])}\n")

    # 2. Arborescence (top-level dirs + key files, compact)
    if has_scan:
        tree = scan["tree"]
        # Show only first-level dirs and root files for compactness
        top_dirs = [e for e in tree if e.endswith("/") and "/" not in e.rstrip("/")]
        key_files = scan.get("key_files", [])
        root_files = [e for e in key_files if "/" not in e]
        # Also include key files one level deep (for monorepos)
        nested_files = [e for e in key_files if "/" in e]
        if top_dirs or root_files or nested_files:
            parts.append("Arborescence: ")
            items = top_dirs[:12] + root_files[:6] + nested_files[:6]
            parts.append(", ".join(items) + "\n")

    # 3. README excerpt
    if has_readme:
        # Reserve remaining budget for README
        current_len = sum(len(p) for p in parts)
        readme_budget = max(100, _LOCAL_CONTEXT_BUDGET - current_len - 20)
        readme_text = scan["readme"].strip().replace("\n", " ")[:readme_budget]
        parts.append(f"README: {readme_text}\n")

    # Final trim to budget
    result = "".join(parts)
    if len(result) > _LOCAL_CONTEXT_BUDGET:
        result = result[:_LOCAL_CONTEXT_BUDGET - 3] + "...\n"

    return result


def _build_suggestion_prompt(
    tasks: list[Task],
    projects: list[Project],
    project_id: str | None = None,
) -> str:
    """Build a prompt for Claude to suggest new tasks based on existing context."""
    prompt = (
        "Tu es un assistant de productivite intelligent. "
        "Analyse les taches et projets existants de l'utilisateur, "
        "puis suggere de nouvelles taches pertinentes qu'il devrait envisager.\n\n"
    )

    # Current projects
    if projects:
        prompt += "# Projets existants\n"
        for p in projects:
            prompt += f'- "{p.name}"'
            if p.category:
                prompt += f" (categorie: {p.category})"
            if p.notes:
                prompt += f" — {p.notes[:200]}"
            prompt += "\n"
        prompt += "\n"

    # Current tasks grouped by status
    open_tasks = [t for t in tasks if t.status in ("open", "in_progress", "waiting")]
    done_tasks = [t for t in tasks if t.status == "done"]

    if open_tasks:
        prompt += "# Taches en cours / ouvertes\n"
        for t in open_tasks[:30]:
            prompt += f'- "{t.title}" (status: {t.status}'
            if t.tags:
                tags = json.loads(t.tags) if isinstance(t.tags, str) else t.tags
                if tags:
                    prompt += f", tags: {', '.join(tags)}"
            prompt += f", impact: {t.impact}, effort: {t.effort})\n"
        prompt += "\n"

    if done_tasks:
        prompt += "# Taches recemment terminees\n"
        for t in done_tasks[:15]:
            prompt += f'- "{t.title}"\n'
        prompt += "\n"

    # Scoping
    if project_id:
        project = next((p for p in projects if p.id == project_id), None)
        if project:
            prompt += f'\n# Focus: suggere des taches pour le projet "{project.name}"\n'
            if project.notes:
                prompt += f"Context du projet:\n{project.notes[:500]}\n"

            # Enrich with local project context if local_path is set
            if project.local_path:
                prompt += _build_local_context(project.local_path)

    prompt += "\n# Instructions\n"
    prompt += "En te basant sur le contexte ci-dessus, suggere 3-6 nouvelles taches pertinentes. "
    prompt += "Les suggestions doivent:\n"
    prompt += "- Combler des lacunes evidentes (taches manquantes dans un projet)\n"
    prompt += "- Proposer des ameliorations ou suivis logiques\n"
    prompt += "- Etre concretes et actionnables\n"
    prompt += "- Ne PAS dupliquer les taches existantes\n"
    prompt += "- Avoir un titre court et precis (max 80 chars)\n"
    prompt += "- Inclure une breve raison de la suggestion\n\n"
    prompt += 'Reponds UNIQUEMENT avec un JSON valide (sans markdown, sans backticks) au format:\n'
    prompt += (
        '[{"title": "...", "reason": "...", "impact": 3, "effort": 2, '
        '"estimate_min": 30, "tags": ["..."], "project_id": "..." or null}]\n'
    )
    prompt += "\nPour project_id, utilise l'id du projet le plus pertinent ou null si c'est une tache generale.\n"
    prompt += "Les ids de projets disponibles:\n"
    for p in projects:
        prompt += f'- "{p.id}": {p.name}\n'

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


def _parse_suggestions(response: str) -> list[dict]:
    """Parse Claude's JSON response into a list of suggestion dicts."""
    text = response.strip()
    match = re.search(r'\[[\s\S]*\]', text)
    if match:
        text = match.group(0)
    suggestions = json.loads(text)
    if not isinstance(suggestions, list) or len(suggestions) == 0:
        raise ValueError("Claude returned no suggestions")
    return suggestions


def generate_suggestions(
    db: Session,
    project_id: str | None = None,
) -> list[dict]:
    """
    Generate task suggestions based on existing tasks and projects.
    Returns a list of suggestion dicts for the frontend to display.
    """
    # Fetch existing context
    tasks = (
        db.query(Task)
        .filter(Task.is_deleted == False, Task.parent_task_id == None)
        .order_by(Task.updated_at.desc())
        .limit(50)
        .all()
    )

    projects = (
        db.query(Project)
        .filter(Project.is_deleted == False)
        .all()
    )

    if project_id:
        project_tasks = (
            db.query(Task)
            .filter(Task.is_deleted == False, Task.project_id == project_id)
            .order_by(Task.updated_at.desc())
            .limit(30)
            .all()
        )
        task_ids = {t.id for t in tasks}
        for t in project_tasks:
            if t.id not in task_ids:
                tasks.append(t)

    prompt = _build_suggestion_prompt(tasks, projects, project_id)
    response = _call_claude(prompt)
    parsed = _parse_suggestions(response)

    suggestions = []
    valid_project_ids = {p.id for p in projects}

    for s in parsed:
        tags = s.get("tags", [])
        if isinstance(tags, str):
            tags = [tags]

        pid = s.get("project_id")
        if pid and pid not in valid_project_ids:
            pid = None

        suggestions.append({
            "title": s.get("title", "Sans titre")[:500],
            "reason": s.get("reason", "")[:500],
            "impact": max(1, min(5, s.get("impact", 3))),
            "effort": max(1, min(5, s.get("effort", 3))),
            "estimate_min": max(5, min(480, s.get("estimate_min", 30))),
            "tags": tags if isinstance(tags, list) else [],
            "project_id": pid,
        })

    return suggestions
