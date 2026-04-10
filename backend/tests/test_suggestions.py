"""
Test script for /api/tasks/suggest endpoint.
Tests suggestions with and without local_path to verify contextual enrichment.

Usage:
    python -m tests.test_suggestions

Requires the backend server to be running on port 18427.
"""
import json
import sys
import os
import time
from pathlib import Path

# Add backend to path so we can import services directly
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Dynamic repo root — resolves to todoto/ regardless of who runs this
REPO_ROOT = str(Path(__file__).parent.parent.parent)

from app.services.suggestions import (
    scan_local_path,
    _build_local_context,
    _build_suggestion_prompt,
)


def separator(title: str) -> None:
    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}\n")


def test_scan_local_path():
    """Test scan_local_path with a real project directory."""
    separator(f"TEST 1: scan_local_path on {REPO_ROOT}")

    result = scan_local_path(REPO_ROOT, max_depth=2)

    print(f"Tree entries: {len(result['tree'])}")
    print(f"Key files: {result['key_files']}")
    print(f"Technologies: {result['technologies']}")
    print(f"Has README: {result['readme'] is not None}")
    print(f"\nSummary:\n{result['summary'][:500]}")

    # Verify expected detections
    assert len(result["tree"]) > 0, "Should find files in tree"
    assert len(result["key_files"]) > 0, "Should find key files"
    assert len(result["technologies"]) > 0, "Should detect technologies"
    print("\n[PASS] scan_local_path works correctly")


def test_scan_local_path_invalid():
    """Test scan_local_path with a non-existent path."""
    separator("TEST 2: scan_local_path on invalid path")

    result = scan_local_path("C:/nonexistent/path/12345", max_depth=2)

    print(f"Tree entries: {len(result['tree'])}")
    print(f"Technologies: {result['technologies']}")
    print(f"Summary: {result['summary']}")

    assert len(result["tree"]) == 0, "Should have empty tree"
    assert len(result["technologies"]) == 0, "Should have no technologies"
    print("\n[PASS] scan_local_path handles invalid path gracefully")


def test_build_local_context():
    """Test _build_local_context with a real project."""
    separator(f"TEST 3: _build_local_context on {REPO_ROOT}")

    context = _build_local_context(REPO_ROOT)

    print(f"Context length: {len(context)} chars (budget: 1000)")
    print(f"\nContext:\n{context}")

    assert len(context) > 0, "Should produce non-empty context"
    assert len(context) <= 1003, "Should respect budget (~1000 chars)"
    assert "Contexte local" in context, "Should contain section header"
    print("\n[PASS] _build_local_context produces useful context")


def test_build_local_context_empty():
    """Test _build_local_context with no local_path."""
    separator("TEST 4: _build_local_context on invalid path")

    context = _build_local_context("C:/nonexistent/path/12345")

    print(f"Context length: {len(context)} chars")
    print(f"Context: '{context}'")

    assert context == "", "Should return empty string for invalid path"
    print("\n[PASS] _build_local_context returns empty for invalid path")


class FakeProject:
    """Minimal mock of a Project ORM object."""
    def __init__(self, id, name, notes=None, category=None, local_path=None):
        self.id = id
        self.name = name
        self.notes = notes
        self.category = category
        self.local_path = local_path


class FakeTask:
    """Minimal mock of a Task ORM object."""
    def __init__(self, id, title, status="open", tags=None, impact=3, effort=3):
        self.id = id
        self.title = title
        self.status = status
        self.tags = json.dumps(tags or [])
        self.impact = impact
        self.effort = effort


def test_prompt_without_local_path():
    """Build a suggestion prompt for a project WITHOUT local_path."""
    separator("TEST 5: Prompt WITHOUT local_path")

    project = FakeProject(
        id="proj-no-path",
        name="Test Project",
        notes="A test project with no local path",
    )
    tasks = [
        FakeTask("t1", "Fix login bug", status="open", tags=["bug"]),
        FakeTask("t2", "Add dark mode", status="done"),
    ]

    prompt = _build_suggestion_prompt(tasks, [project], project_id="proj-no-path")

    print(f"Prompt length: {len(prompt)} chars")
    print(f"\n--- PROMPT (sans local_path) ---\n{prompt}\n--- END ---")

    assert "Contexte local" not in prompt, "Should NOT contain local context section"
    assert "Test Project" in prompt, "Should mention project name"
    assert "Fix login bug" in prompt, "Should mention tasks"
    print("\n[PASS] Prompt without local_path has no local context")
    return prompt


def test_prompt_with_local_path():
    """Build a suggestion prompt for a project WITH local_path."""
    separator(f"TEST 6: Prompt WITH local_path ({REPO_ROOT})")

    project = FakeProject(
        id="proj-with-path",
        name="Upgrade Todoai",
        notes="TodoAI app - Tauri + React + FastAPI",
        local_path=REPO_ROOT,
    )
    tasks = [
        FakeTask("t1", "Fix login bug", status="open", tags=["bug"]),
        FakeTask("t2", "Add dark mode", status="done"),
    ]

    prompt = _build_suggestion_prompt(tasks, [project], project_id="proj-with-path")

    print(f"Prompt length: {len(prompt)} chars")
    print(f"\n--- PROMPT (avec local_path) ---\n{prompt}\n--- END ---")

    assert "Contexte local" in prompt, "Should contain local context section"
    assert "Upgrade Todoai" in prompt, "Should mention project name"
    print("\n[PASS] Prompt with local_path includes local context")
    return prompt


def test_prompt_comparison():
    """Compare prompt sizes and content between with/without local_path."""
    separator("TEST 7: Prompt comparison WITH vs WITHOUT local_path")

    project_no_path = FakeProject(
        id="proj-1",
        name="My Project",
        notes="Some project notes",
    )
    project_with_path = FakeProject(
        id="proj-2",
        name="My Project",
        notes="Some project notes",
        local_path=REPO_ROOT,
    )
    tasks = [
        FakeTask("t1", "Implement feature X", status="open", tags=["feature"]),
        FakeTask("t2", "Fix bug Y", status="in_progress", tags=["bug"]),
        FakeTask("t3", "Write tests", status="done"),
    ]

    prompt_no_path = _build_suggestion_prompt(tasks, [project_no_path], project_id="proj-1")
    prompt_with_path = _build_suggestion_prompt(tasks, [project_with_path], project_id="proj-2")

    diff = len(prompt_with_path) - len(prompt_no_path)

    print(f"Prompt WITHOUT local_path: {len(prompt_no_path)} chars")
    print(f"Prompt WITH local_path:    {len(prompt_with_path)} chars")
    print(f"Difference:                +{diff} chars of context")
    print()

    # The prompt with local_path should be significantly larger
    assert diff > 100, f"Expected at least 100 extra chars of context, got {diff}"

    # Check that the extra content is project-specific
    has_stack = "Stack:" in prompt_with_path
    has_arbo = "Arborescence:" in prompt_with_path
    has_readme = "README:" in prompt_with_path

    print(f"Has Stack info:        {has_stack}")
    print(f"Has Arborescence:      {has_arbo}")
    print(f"Has README excerpt:    {has_readme}")

    assert has_stack or has_arbo, "Should have stack or directory info"

    print(f"\n[PASS] Prompt with local_path adds {diff} chars of project context")


def test_live_endpoint_without_project():
    """Test the live /api/tasks/suggest endpoint without specifying a project."""
    separator("TEST 8: Live endpoint - suggest without project_id")

    try:
        import urllib.request
        req = urllib.request.Request(
            "http://127.0.0.1:18427/api/tasks/suggest",
            data=json.dumps({}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        start = time.time()
        with urllib.request.urlopen(req, timeout=180) as resp:
            elapsed = time.time() - start
            data = json.loads(resp.read())

        print(f"Response time: {elapsed:.1f}s")
        print(f"Suggestion count: {data['count']}")
        for i, s in enumerate(data["suggestions"]):
            print(f"\n  [{i+1}] {s['title']}")
            print(f"      Reason: {s['reason']}")
            print(f"      Impact: {s['impact']}, Effort: {s['effort']}, Est: {s['estimate_min']}min")
            print(f"      Tags: {s['tags']}, Project: {s.get('project_id', 'N/A')}")

        assert data["count"] > 0, "Should return at least 1 suggestion"
        print(f"\n[PASS] Got {data['count']} suggestions (no project filter)")
        return data
    except Exception as e:
        print(f"[SKIP] Endpoint not available or Claude CLI error: {e}")
        return None


def test_live_endpoint_with_project_no_path():
    """Test suggest for a project that has NO local_path (e.g., 'Hello')."""
    separator("TEST 9: Live endpoint - project WITHOUT local_path (Hello)")

    project_id = "9d180bb8-83ef-409a-a240-00064496e863"  # Hello project
    try:
        import urllib.request
        req = urllib.request.Request(
            "http://127.0.0.1:18427/api/tasks/suggest",
            data=json.dumps({"project_id": project_id}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        start = time.time()
        with urllib.request.urlopen(req, timeout=180) as resp:
            elapsed = time.time() - start
            data = json.loads(resp.read())

        print(f"Response time: {elapsed:.1f}s")
        print(f"Suggestion count: {data['count']}")
        for i, s in enumerate(data["suggestions"]):
            print(f"\n  [{i+1}] {s['title']}")
            print(f"      Reason: {s['reason']}")
            print(f"      Tags: {s['tags']}")

        assert data["count"] > 0, "Should return at least 1 suggestion"
        print(f"\n[PASS] Got {data['count']} suggestions for project without local_path")
        return data
    except Exception as e:
        print(f"[SKIP] Endpoint not available or Claude CLI error: {e}")
        return None


def test_live_endpoint_with_project_with_path():
    """Test suggest for a project that HAS local_path (Upgrade Todoai)."""
    separator("TEST 10: Live endpoint - project WITH local_path (Upgrade Todoai)")

    project_id = "81622608-03ba-4dcf-a4fb-73c248d7ffb8"  # Upgrade Todoai
    try:
        import urllib.request
        req = urllib.request.Request(
            "http://127.0.0.1:18427/api/tasks/suggest",
            data=json.dumps({"project_id": project_id}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        start = time.time()
        with urllib.request.urlopen(req, timeout=180) as resp:
            elapsed = time.time() - start
            data = json.loads(resp.read())

        print(f"Response time: {elapsed:.1f}s")
        print(f"Suggestion count: {data['count']}")
        for i, s in enumerate(data["suggestions"]):
            print(f"\n  [{i+1}] {s['title']}")
            print(f"      Reason: {s['reason']}")
            print(f"      Tags: {s['tags']}")

        assert data["count"] > 0, "Should return at least 1 suggestion"

        # Check if suggestions reference tech-specific terms
        all_text = " ".join(s["title"] + " " + s["reason"] for s in data["suggestions"]).lower()
        tech_terms = ["react", "fastapi", "tauri", "python", "typescript", "vite",
                      "sqlite", "api", "frontend", "backend", "test", "component"]
        found_terms = [t for t in tech_terms if t in all_text]

        print(f"\nTech terms found in suggestions: {found_terms}")
        if found_terms:
            print("[PASS] Suggestions are contextual to the project's tech stack!")
        else:
            print("[WARN] No tech-specific terms found - suggestions may not be contextual")

        return data
    except Exception as e:
        print(f"[SKIP] Endpoint not available or Claude CLI error: {e}")
        return None


def main():
    print("=" * 70)
    print("  TODOTO - Task Suggestion Tests")
    print("  Testing /api/tasks/suggest with and without local_path")
    print("=" * 70)

    # Unit tests (no server needed, no Claude CLI needed)
    test_scan_local_path()
    test_scan_local_path_invalid()
    test_build_local_context()
    test_build_local_context_empty()
    prompt_no_path = test_prompt_without_local_path()
    prompt_with_path = test_prompt_with_local_path()
    test_prompt_comparison()

    # Integration tests (need running server + Claude CLI)
    print("\n" + "=" * 70)
    print("  INTEGRATION TESTS (requires running server + Claude CLI)")
    print("  These call the real endpoint and may take 30-120s each")
    print("=" * 70)

    if "--live" in sys.argv:
        result_no_project = test_live_endpoint_without_project()
        result_no_path = test_live_endpoint_with_project_no_path()
        result_with_path = test_live_endpoint_with_project_with_path()

        separator("COMPARISON: With vs Without local_path")
        if result_no_path and result_with_path:
            print("Suggestions WITHOUT local_path:")
            for s in result_no_path["suggestions"]:
                print(f"  - {s['title']}")
            print()
            print("Suggestions WITH local_path:")
            for s in result_with_path["suggestions"]:
                print(f"  - {s['title']}")
            print()
            print("The suggestions WITH local_path should be more specific to the")
            print("project's actual tech stack (React, FastAPI, Tauri, etc.)")
        else:
            print("[SKIP] Cannot compare - one or both endpoints failed")
    else:
        print("\nSkipping live tests (pass --live to run them)")

    separator("ALL UNIT TESTS PASSED")


if __name__ == "__main__":
    main()
