from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.task import Task, TaskTrigger, TaskDependency
from ..models.project import Project
from ..schemas import (
    TaskCreate, TaskUpdate, TaskOut, CompleteTaskOut,
    BulkTaskCreate, DumpCreate,
    TaskTriggerCreate, TaskTriggerOut,
    AddDependencyRequest, TaskDependencyOut,
    GraphNode, GraphEdge, DependencyGraphOut,
    PlanGenerateRequest, PlanGenerateOut,
    PlanPreviewOut, SubtaskProposal, PlanConfirmRequest,
    SuggestRequest, SuggestionsOut, TaskSuggestion,
)
from ..services.audit import log_action, compute_diff
from ..config import settings

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _notify(request: Request, action: str, entity_id: str = ""):
    request.app.state.notify_change("task", action, entity_id)


def _task_or_404(db: Session, task_id: str) -> Task:
    t = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not t:
        raise HTTPException(404, "Task not found")
    return t


@router.get("")
def list_tasks(
    project_id: str | None = Query(None),
    status: str | None = Query(None),
    parent_task_id: str | None = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Task).filter(Task.is_deleted == False)
    if project_id:
        q = q.filter(Task.project_id == project_id)
    if status:
        q = q.filter(Task.status == status)
    if parent_task_id:
        q = q.filter(Task.parent_task_id == parent_task_id)
    else:
        q = q.filter(Task.parent_task_id == None)
    tasks = q.order_by(Task.position, Task.created_at).all()
    for t in tasks:
        t.compute_score()
    db.flush()
    return [TaskOut.from_orm_filtered(t) for t in tasks]


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskCreate, request: Request, db: Session = Depends(get_db)):
    task = Task(**data.model_dump())
    task.compute_score()
    db.add(task)
    db.flush()
    log_action(db, "create", "task", task.id)
    db.commit()
    db.refresh(task)
    _notify(request, "create", task.id)
    return task


@router.post("/bulk", response_model=list[TaskOut], status_code=201)
def bulk_create_tasks(data: BulkTaskCreate, request: Request, db: Session = Depends(get_db)):
    if len(data.tasks) > settings.bulk_create_limit:
        raise HTTPException(400, f"Maximum {settings.bulk_create_limit} tasks per bulk create")
    created = []
    for td in data.tasks:
        task = Task(**td.model_dump())
        task.compute_score()
        db.add(task)
        db.flush()
        log_action(db, "create", "task", task.id)
        created.append(task)
    db.commit()
    for t in created:
        db.refresh(t)
    _notify(request, "bulk_create")
    return created


@router.post("/dump", response_model=list[TaskOut], status_code=201)
def dump_create(data: DumpCreate, request: Request, db: Session = Depends(get_db)):
    lines = [line.strip() for line in data.text.strip().split("\n") if line.strip()]
    if len(lines) > settings.bulk_create_limit:
        raise HTTPException(400, f"Maximum {settings.bulk_create_limit} tasks per dump")
    created = []
    for i, line in enumerate(lines):
        line = line.lstrip("•-* ").strip()
        if not line:
            continue
        task = Task(title=line, project_id=data.project_id, position=i)
        task.compute_score()
        db.add(task)
        db.flush()
        log_action(db, "create", "task", task.id, {"source": "dump"})
        created.append(task)
    db.commit()
    for t in created:
        db.refresh(t)
    _notify(request, "dump_create")
    return created


@router.get("/dependency-graph", response_model=DependencyGraphOut)
def get_dependency_graph(
    project_id: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return nodes (tasks) and edges (dependencies + triggers) for graph rendering."""
    q = db.query(Task).filter(Task.is_deleted == False)
    if project_id:
        q = q.filter(Task.project_id == project_id)
    tasks = q.all()

    task_ids = {t.id for t in tasks}
    nodes = [
        GraphNode(
            id=t.id, title=t.title, status=t.status, project_id=t.project_id,
            impact=t.impact, effort=t.effort, due_at=t.due_at,
        )
        for t in tasks
    ]

    edges: list[GraphEdge] = []

    # Dependency edges (task depends_on prerequisite)
    dep_rows = db.query(TaskDependency).filter(
        TaskDependency.task_id.in_(task_ids) | TaskDependency.depends_on_id.in_(task_ids)
    ).all()
    seen_dep_task_ids: set[str] = set()
    for dep in dep_rows:
        edges.append(GraphEdge(source=dep.depends_on_id, target=dep.task_id, type="dependency"))
        seen_dep_task_ids.update([dep.task_id, dep.depends_on_id])

    # Trigger edges
    trigger_rows = db.query(TaskTrigger).filter(
        TaskTrigger.source_task_id.in_(task_ids) | TaskTrigger.target_task_id.in_(task_ids)
    ).all()
    for tr in trigger_rows:
        edges.append(GraphEdge(source=tr.source_task_id, target=tr.target_task_id, type="trigger"))
        seen_dep_task_ids.update([tr.source_task_id, tr.target_task_id])

    # Add any referenced tasks not already in nodes (cross-project edges)
    missing_ids = seen_dep_task_ids - task_ids
    if missing_ids:
        extra_tasks = db.query(Task).filter(Task.id.in_(missing_ids), Task.is_deleted == False).all()
        for t in extra_tasks:
            nodes.append(GraphNode(id=t.id, title=t.title, status=t.status, project_id=t.project_id))

    return DependencyGraphOut(nodes=nodes, edges=edges)


@router.post("/suggest", response_model=SuggestionsOut)
def suggest_tasks(data: SuggestRequest, db: Session = Depends(get_db)):
    """Generate AI-powered task suggestions based on existing tasks and projects."""
    from ..services.suggestions import generate_suggestions

    suggestions = generate_suggestions(db, project_id=data.project_id)
    return SuggestionsOut(
        suggestions=[TaskSuggestion(**s) for s in suggestions],
        count=len(suggestions),
    )


@router.get("/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db)):
    t = _task_or_404(db, task_id)
    t.compute_score()
    return TaskOut.from_orm_filtered(t)


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: str, data: TaskUpdate, request: Request, db: Session = Depends(get_db)):
    t = _task_or_404(db, task_id)
    old = {c.name: getattr(t, c.name) for c in t.__table__.columns}
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(t, k, v)
    t.compute_score()
    diff = compute_diff(old, {c.name: getattr(t, c.name) for c in t.__table__.columns})
    if diff:
        log_action(db, "update", "task", t.id, diff)
    db.commit()
    db.refresh(t)
    _notify(request, "update", t.id)
    return t


def _check_and_trigger(db: Session, request: Request, completed_task: Task) -> list[Task]:
    """After completing a task, check all trigger links where this task is a source.
    Returns list of tasks that were actually triggered."""
    triggered = []

    # Find all trigger links where this task is a source
    links = db.query(TaskTrigger).filter(TaskTrigger.source_task_id == completed_task.id).all()

    for link in links:
        target = db.query(Task).filter(
            Task.id == link.target_task_id,
            Task.is_deleted == False,
        ).first()
        if not target or target.status in ("done", "archived"):
            continue

        # Check trigger mode
        should_trigger = False
        if target.trigger_mode == "or":
            # OR: any source being done triggers
            should_trigger = True
        elif target.trigger_mode == "and":
            # AND: ALL sources must be done
            all_sources = db.query(TaskTrigger).filter(TaskTrigger.target_task_id == target.id).all()
            all_done = all(
                db.query(Task).filter(Task.id == s.source_task_id).first().status == "done"
                for s in all_sources
            )
            should_trigger = all_done

        if should_trigger:
            # Move from waiting to open (or goai if enabled)
            if target.trigger_goai:
                target.status = "goai"
            elif target.status == "waiting":
                target.status = "open"

            target.compute_score()
            log_action(db, "auto_trigger", "task", target.id, {
                "triggered_by": completed_task.id,
                "goai": target.trigger_goai,
            })
            _notify(request, "update", target.id)
            triggered.append(target)

    return triggered


@router.post("/{task_id}/complete", response_model=CompleteTaskOut)
def complete_task(task_id: str, request: Request, db: Session = Depends(get_db)):
    t = _task_or_404(db, task_id)
    t.status = "done"
    log_action(db, "complete", "task", t.id)
    db.commit()
    db.refresh(t)
    _notify(request, "complete", t.id)

    # Check trigger links
    triggered = _check_and_trigger(db, request, t)
    db.commit()
    for tr in triggered:
        db.refresh(tr)

    triggered_out = [TaskOut.from_orm_filtered(tr) for tr in triggered]
    # Find the first triggered task that should be sent to GoAi
    next_goai = next((tr for tr in triggered_out if tr.trigger_goai and tr.status == "goai"), None)

    return CompleteTaskOut(
        task=TaskOut.from_orm_filtered(t),
        triggered_tasks=triggered_out,
        next_goai_task=next_goai,
    )


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: str, request: Request, db: Session = Depends(get_db)):
    t = _task_or_404(db, task_id)
    t.is_deleted = True
    log_action(db, "soft_delete", "task", t.id)
    db.commit()
    _notify(request, "delete", t.id)


@router.post("/{task_id}/move", response_model=TaskOut)
def move_task(task_id: str, request: Request, project_id: str | None = None, parent_task_id: str | None = None, position: int = 0, db: Session = Depends(get_db)):
    t = _task_or_404(db, task_id)
    old_project = t.project_id
    old_parent = t.parent_task_id
    t.project_id = project_id
    t.parent_task_id = parent_task_id

    # Fetch all siblings in the target container (same project + same parent)
    siblings = (
        db.query(Task)
        .filter(
            Task.is_deleted == False,
            Task.id != task_id,
            (Task.project_id == project_id) if project_id else (Task.project_id == None),
            (Task.parent_task_id == parent_task_id) if parent_task_id else (Task.parent_task_id == None),
        )
        .order_by(Task.position, Task.created_at)
        .all()
    )

    # Insert the moved task at the requested position and reindex all
    ordered = list(siblings)
    pos = max(0, min(position, len(ordered)))
    ordered.insert(pos, t)
    for i, sibling in enumerate(ordered):
        sibling.position = i

    log_action(db, "move", "task", t.id, {
        "project_id": {"old": old_project, "new": project_id},
        "parent_task_id": {"old": old_parent, "new": parent_task_id},
        "position": position,
    })
    db.commit()
    db.refresh(t)
    _notify(request, "move", t.id)
    return t


# --- Plan generation endpoints ---

def _get_project_local_path(db: Session, task: Task) -> str | None:
    """Return the local_path of the task's parent project, if any."""
    if not task.project_id:
        return None
    proj = db.query(Project).filter(Project.id == task.project_id).first()
    return proj.local_path if proj else None


@router.post("/{task_id}/generate-plan", response_model=PlanGenerateOut)
def generate_plan(task_id: str, data: PlanGenerateRequest, request: Request, db: Session = Depends(get_db)):
    """Legacy: Generate and immediately create subtasks (no preview)."""
    from ..services.plan_generator import generate_plan_for_task

    t = _task_or_404(db, task_id)
    created = generate_plan_for_task(
        db, t,
        project_name=data.project_name,
        project_notes=data.project_notes,
        local_path=_get_project_local_path(db, t),
    )
    db.commit()
    for c in created:
        db.refresh(c)
    _notify(request, "plan_generated", task_id)
    return PlanGenerateOut(
        parent_task_id=task_id,
        subtasks=[TaskOut.from_orm_filtered(c) for c in created],
        count=len(created),
    )


@router.post("/{task_id}/plan-preview", response_model=PlanPreviewOut)
def plan_preview(task_id: str, data: PlanGenerateRequest, db: Session = Depends(get_db)):
    """Phase 1: Generate subtask proposals for review (nothing is created yet)."""
    from ..services.plan_generator import generate_plan_preview

    t = _task_or_404(db, task_id)
    proposals = generate_plan_preview(
        t,
        project_name=data.project_name,
        project_notes=data.project_notes,
        local_path=_get_project_local_path(db, t),
    )
    return PlanPreviewOut(
        parent_task_id=task_id,
        proposals=[SubtaskProposal(**p) for p in proposals],
        count=len(proposals),
    )


@router.post("/{task_id}/plan-confirm", response_model=PlanGenerateOut)
def plan_confirm(task_id: str, data: PlanConfirmRequest, request: Request, db: Session = Depends(get_db)):
    """Phase 2: Create the reviewed/edited subtasks after user confirmation."""
    from ..services.plan_generator import confirm_plan_subtasks

    t = _task_or_404(db, task_id)
    created = confirm_plan_subtasks(
        db, t,
        [s.model_dump() for s in data.subtasks],
    )
    db.commit()
    for c in created:
        db.refresh(c)
    _notify(request, "plan_confirmed", task_id)
    return PlanGenerateOut(
        parent_task_id=task_id,
        subtasks=[TaskOut.from_orm_filtered(c) for c in created],
        count=len(created),
    )


# --- Auto-plan endpoint (plan mode: subtasks before coding) ---

@router.post("/{task_id}/auto-plan", response_model=PlanGenerateOut)
def auto_plan(task_id: str, data: PlanGenerateRequest, request: Request, db: Session = Depends(get_db)):
    """
    Plan mode: automatically decompose a task into subtasks before coding.
    Unlike plan-preview + plan-confirm (two-phase), this generates and creates
    subtasks in one step. Skips if the task already has active subtasks.
    Returns the created subtasks.
    """
    from ..services.plan_generator import generate_plan_for_task

    t = _task_or_404(db, task_id)

    # Skip if the task already has active subtasks
    active_subtasks = [
        st for st in (t.subtasks or [])
        if not st.is_deleted and st.status not in ("done", "archived")
    ]
    if active_subtasks:
        return PlanGenerateOut(
            parent_task_id=task_id,
            subtasks=[TaskOut.from_orm_filtered(st) for st in active_subtasks],
            count=len(active_subtasks),
        )

    created = generate_plan_for_task(
        db, t,
        project_name=data.project_name,
        project_notes=data.project_notes,
        local_path=_get_project_local_path(db, t),
    )
    db.commit()
    for c in created:
        db.refresh(c)
    _notify(request, "plan_generated", task_id)
    return PlanGenerateOut(
        parent_task_id=task_id,
        subtasks=[TaskOut.from_orm_filtered(c) for c in created],
        count=len(created),
    )


# --- Trigger link endpoints ---

def _would_create_cycle(db: Session, source_id: str, target_id: str) -> bool:
    """Check if adding a trigger edge source→target would create a cycle.
    A cycle exists if there is already a path from target back to source
    in the existing trigger graph (DFS from target following outgoing edges)."""
    visited: set[str] = set()
    stack = [target_id]
    while stack:
        node = stack.pop()
        if node == source_id:
            return True
        if node in visited:
            continue
        visited.add(node)
        # Follow outgoing trigger edges: node is a source, find its targets
        neighbors = db.query(TaskTrigger.target_task_id).filter(
            TaskTrigger.source_task_id == node
        ).all()
        for (neighbor_id,) in neighbors:
            if neighbor_id not in visited:
                stack.append(neighbor_id)
    return False


@router.post("/{task_id}/triggers", response_model=TaskTriggerOut, status_code=201)
def add_trigger(task_id: str, data: TaskTriggerCreate, request: Request, db: Session = Depends(get_db)):
    """Add a trigger link. task_id is ignored in URL - source/target come from body."""
    _task_or_404(db, data.source_task_id)
    _task_or_404(db, data.target_task_id)
    if data.source_task_id == data.target_task_id:
        raise HTTPException(400, "A task cannot trigger itself")
    # Check duplicate
    existing = db.query(TaskTrigger).filter(
        TaskTrigger.source_task_id == data.source_task_id,
        TaskTrigger.target_task_id == data.target_task_id,
    ).first()
    if existing:
        raise HTTPException(400, "Trigger link already exists")
    # Check for cycles: would adding source→target create a circular dependency?
    if _would_create_cycle(db, data.source_task_id, data.target_task_id):
        raise HTTPException(400, "Cannot add trigger: would create a circular dependency")
    link = TaskTrigger(source_task_id=data.source_task_id, target_task_id=data.target_task_id)
    db.add(link)
    # Auto-set target task to "waiting" if it's currently "open"
    target = db.query(Task).filter(Task.id == data.target_task_id).first()
    if target and target.status == "open":
        target.status = "waiting"
        log_action(db, "auto_waiting", "task", target.id, {"triggered_by_link": data.source_task_id})
    db.commit()
    db.refresh(link)
    _notify(request, "update", data.source_task_id)
    _notify(request, "update", data.target_task_id)
    return link


@router.delete("/{task_id}/triggers/{trigger_id}", status_code=204)
def remove_trigger(task_id: str, trigger_id: str, request: Request, db: Session = Depends(get_db)):
    link = db.query(TaskTrigger).filter(TaskTrigger.id == trigger_id).first()
    if not link:
        raise HTTPException(404, "Trigger link not found")
    source_id = link.source_task_id
    target_id = link.target_task_id
    db.delete(link)
    db.flush()
    # If no more triggers_in remain and target is "waiting", revert to "open"
    remaining = db.query(TaskTrigger).filter(TaskTrigger.target_task_id == target_id).count()
    if remaining == 0:
        target = db.query(Task).filter(Task.id == target_id).first()
        if target and target.status == "waiting":
            target.status = "open"
            log_action(db, "auto_open", "task", target.id, {"reason": "no_more_triggers"})
    db.commit()
    _notify(request, "update", source_id)
    _notify(request, "update", target_id)


# --- Dependency endpoints ---

def _dependency_would_create_cycle(db: Session, task_id: str, depends_on_id: str) -> bool:
    """Check if adding task_id→depends_on_id would create a cycle.
    A cycle exists if there is already a path from depends_on_id back to task_id
    in the existing dependency graph (DFS)."""
    visited: set[str] = set()
    stack = [depends_on_id]
    while stack:
        node = stack.pop()
        if node == task_id:
            return True
        if node in visited:
            continue
        visited.add(node)
        # Follow dependency edges: node depends on X → go to X
        neighbors = db.query(TaskDependency.depends_on_id).filter(
            TaskDependency.task_id == node
        ).all()
        for (neighbor_id,) in neighbors:
            if neighbor_id not in visited:
                stack.append(neighbor_id)
    return False


@router.post("/{task_id}/dependencies", response_model=TaskDependencyOut, status_code=201)
def add_dependency(task_id: str, data: AddDependencyRequest, request: Request, db: Session = Depends(get_db)):
    """Add a dependency: task_id depends on data.depends_on_id (prerequisite)."""
    task = _task_or_404(db, task_id)
    prerequisite = _task_or_404(db, data.depends_on_id)

    if task_id == data.depends_on_id:
        raise HTTPException(400, "A task cannot depend on itself")

    # Check duplicate
    existing = db.query(TaskDependency).filter(
        TaskDependency.task_id == task_id,
        TaskDependency.depends_on_id == data.depends_on_id,
    ).first()
    if existing:
        raise HTTPException(400, "Dependency already exists")

    # Check for cycles
    if _dependency_would_create_cycle(db, task_id, data.depends_on_id):
        raise HTTPException(400, "Cannot add dependency: would create a circular dependency")

    dep = TaskDependency(task_id=task_id, depends_on_id=data.depends_on_id)
    db.add(dep)
    log_action(db, "add_dependency", "task", task_id, {"depends_on_id": data.depends_on_id})
    db.commit()
    db.refresh(dep)
    _notify(request, "update", task_id)
    _notify(request, "update", data.depends_on_id)
    return dep


@router.delete("/{task_id}/dependencies/{depends_on_id}", status_code=204)
def remove_dependency(task_id: str, depends_on_id: str, request: Request, db: Session = Depends(get_db)):
    """Remove a dependency: task_id no longer depends on depends_on_id."""
    dep = db.query(TaskDependency).filter(
        TaskDependency.task_id == task_id,
        TaskDependency.depends_on_id == depends_on_id,
    ).first()
    if not dep:
        raise HTTPException(404, "Dependency not found")
    db.delete(dep)
    log_action(db, "remove_dependency", "task", task_id, {"depends_on_id": depends_on_id})
    db.commit()
    _notify(request, "update", task_id)
    _notify(request, "update", depends_on_id)
