from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from ..models.task import Task


def plan_today(db: Session, available_minutes: int = 480, focus_project_id: str | None = None) -> dict:
    query = db.query(Task).filter(
        Task.status == "open",
        Task.is_deleted == False,
        Task.parent_task_id == None,
    )

    if focus_project_id:
        query = query.filter(Task.project_id == focus_project_id)

    tasks = query.all()
    for t in tasks:
        t.compute_score()
    db.flush()

    tasks.sort(key=lambda t: t.score, reverse=True)

    planned = []
    total_min = 0
    now = datetime.now(timezone.utc).replace(hour=9, minute=0, second=0, microsecond=0)

    for task in tasks:
        if total_min + task.estimate_min > available_minutes:
            continue
        start = now + timedelta(minutes=total_min)
        end = start + timedelta(minutes=task.estimate_min)
        planned.append({
            "task_id": task.id,
            "title": task.title,
            "start_at": start,
            "end_at": end,
            "score": task.score,
        })
        total_min += task.estimate_min

    return {
        "tasks": planned,
        "total_minutes": total_min,
        "remaining_minutes": available_minutes - total_min,
    }
