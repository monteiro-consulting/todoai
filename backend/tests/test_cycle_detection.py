"""
Test script for cycle detection in the trigger dependency graph.
Validates that circular dependencies are rejected with HTTP 400.

Usage:
    cd backend && python -m tests.test_cycle_detection
"""
import json
import sys
import os
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Create a temp DB file for testing
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp_path = _tmp.name
_tmp.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_path}"

# Now import app modules (they'll use the temp DB)
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from app.database import Base, get_db, engine
from app.models.task import Task, TaskTrigger, TaskDependency
from app.models.project import Project
from app.main import app

# Create tables in the temp DB
Base.metadata.create_all(bind=engine)

# Use starlette TestClient (bundled with FastAPI)
from starlette.testclient import TestClient

client = TestClient(app)


def _create_task(title: str) -> str:
    """Create a task and return its ID."""
    resp = client.post("/api/tasks", json={"title": title})
    assert resp.status_code == 201, f"Failed to create task: {resp.text}"
    return resp.json()["id"]


def _add_trigger(source_id: str, target_id: str) -> object:
    """Add a trigger link and return the response."""
    return client.post(f"/api/tasks/{source_id}/triggers", json={
        "source_task_id": source_id,
        "target_task_id": target_id,
    })


def separator(title: str) -> None:
    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}\n")


def test_self_trigger_rejected():
    """A task cannot trigger itself."""
    separator("TEST 1: Self-trigger rejected")
    a = _create_task("Task A")
    resp = _add_trigger(a, a)
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
    assert "cannot trigger itself" in resp.json()["detail"].lower()
    print("[PASS] Self-trigger correctly rejected with 400")


def test_simple_trigger_allowed():
    """A -> B is fine (no cycle)."""
    separator("TEST 2: Simple trigger A->B allowed")
    a = _create_task("Task A")
    b = _create_task("Task B")
    resp = _add_trigger(a, b)
    assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.text}"
    print("[PASS] A->B trigger created successfully")


def test_direct_cycle_rejected():
    """A -> B then B -> A creates a direct cycle."""
    separator("TEST 3: Direct cycle A->B->A rejected")
    a = _create_task("Task A")
    b = _create_task("Task B")
    resp1 = _add_trigger(a, b)
    assert resp1.status_code == 201, f"A->B failed: {resp1.text}"
    print("  A->B created OK")

    resp2 = _add_trigger(b, a)
    assert resp2.status_code == 400, f"Expected 400, got {resp2.status_code}: {resp2.text}"
    assert "circular" in resp2.json()["detail"].lower()
    print("  B->A rejected with cycle detection")
    print("[PASS] Direct cycle correctly rejected")


def test_indirect_cycle_rejected():
    """A -> B -> C then C -> A creates an indirect cycle."""
    separator("TEST 4: Indirect cycle A->B->C->A rejected")
    a = _create_task("Task A")
    b = _create_task("Task B")
    c = _create_task("Task C")

    resp1 = _add_trigger(a, b)
    assert resp1.status_code == 201
    print("  A->B created OK")

    resp2 = _add_trigger(b, c)
    assert resp2.status_code == 201
    print("  B->C created OK")

    resp3 = _add_trigger(c, a)
    assert resp3.status_code == 400, f"Expected 400, got {resp3.status_code}: {resp3.text}"
    assert "circular" in resp3.json()["detail"].lower()
    print("  C->A rejected with cycle detection")
    print("[PASS] Indirect cycle (length 3) correctly rejected")


def test_long_chain_cycle_rejected():
    """A -> B -> C -> D -> E then E -> A creates a long cycle."""
    separator("TEST 5: Long chain cycle A->B->C->D->E->A rejected")
    tasks = [_create_task(f"Task {chr(65+i)}") for i in range(5)]

    for i in range(4):
        resp = _add_trigger(tasks[i], tasks[i + 1])
        assert resp.status_code == 201
        print(f"  {chr(65+i)}->{chr(66+i)} created OK")

    resp = _add_trigger(tasks[4], tasks[0])
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
    assert "circular" in resp.json()["detail"].lower()
    print("  E->A rejected with cycle detection")
    print("[PASS] Long chain cycle (length 5) correctly rejected")


def test_diamond_no_cycle_allowed():
    """Diamond: A->B, A->C, B->D, C->D is NOT a cycle."""
    separator("TEST 6: Diamond shape (no cycle) allowed")
    a = _create_task("Task A")
    b = _create_task("Task B")
    c = _create_task("Task C")
    d = _create_task("Task D")

    for src, tgt, label in [(a, b, "A->B"), (a, c, "A->C"), (b, d, "B->D"), (c, d, "C->D")]:
        resp = _add_trigger(src, tgt)
        assert resp.status_code == 201, f"{label} failed: {resp.text}"
        print(f"  {label} created OK")

    print("[PASS] Diamond shape correctly allowed (no cycle)")


def test_complex_graph_cycle_detected():
    """Complex graph: A->B, B->C, C->D, D->B creates a cycle through B->C->D->B."""
    separator("TEST 7: Complex graph with inner cycle")
    a = _create_task("Task A")
    b = _create_task("Task B")
    c = _create_task("Task C")
    d = _create_task("Task D")

    for src, tgt, label in [(a, b, "A->B"), (b, c, "B->C"), (c, d, "C->D")]:
        resp = _add_trigger(src, tgt)
        assert resp.status_code == 201
        print(f"  {label} created OK")

    resp = _add_trigger(d, b)
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
    assert "circular" in resp.json()["detail"].lower()
    print("  D->B rejected (would create B->C->D->B cycle)")
    print("[PASS] Inner cycle correctly detected")


def test_duplicate_trigger_rejected():
    """Duplicate A->B trigger should be rejected."""
    separator("TEST 8: Duplicate trigger rejected")
    a = _create_task("Task A")
    b = _create_task("Task B")
    resp1 = _add_trigger(a, b)
    assert resp1.status_code == 201
    print("  A->B created OK")

    resp2 = _add_trigger(a, b)
    assert resp2.status_code == 400
    assert "already exists" in resp2.json()["detail"].lower()
    print("  Duplicate A->B rejected")
    print("[PASS] Duplicate trigger correctly rejected")


def main():
    print("=" * 70)
    print("  TODOTO - Cycle Detection Tests")
    print("  Testing circular dependency prevention in trigger graph")
    print("=" * 70)

    try:
        test_self_trigger_rejected()
        test_simple_trigger_allowed()
        test_direct_cycle_rejected()
        test_indirect_cycle_rejected()
        test_long_chain_cycle_rejected()
        test_diamond_no_cycle_allowed()
        test_complex_graph_cycle_detected()
        test_duplicate_trigger_rejected()

        separator("ALL 8 TESTS PASSED")
    finally:
        # Cleanup temp DB
        try:
            os.unlink(_tmp_path)
        except OSError:
            pass


if __name__ == "__main__":
    main()
