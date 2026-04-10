import csv
import io
import json
import zipfile
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse, JSONResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.task import Task
from ..models.project import Project

router = APIRouter(prefix="/data", tags=["data"])


@router.get("/export")
def export_data(format: str = Query("json", pattern=r"^(json|csv)$"), db: Session = Depends(get_db)):
    projects = db.query(Project).filter(Project.is_deleted == False).all()
    tasks = db.query(Task).filter(Task.is_deleted == False).all()

    if format == "json":
        data = {
            "projects": [
                {
                    "id": p.id,
                    "parent_project_id": p.parent_project_id,
                    "category": p.category,
                    "name": p.name,
                    "color": p.color,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                }
                for p in projects
            ],
            "tasks": [
                {
                    "id": t.id,
                    "project_id": t.project_id,
                    "parent_task_id": t.parent_task_id,
                    "title": t.title,
                    "notes": t.notes,
                    "status": t.status,
                    "due_at": t.due_at.isoformat() if t.due_at else None,
                    "impact": t.impact,
                    "effort": t.effort,
                    "priority": t.priority,
                    "tags": t.tags or [],
                    "estimate_min": t.estimate_min,
                    "position": t.position,
                    "created_at": t.created_at.isoformat() if t.created_at else None,
                }
                for t in tasks
            ],
        }
        content = json.dumps(data, indent=2, ensure_ascii=False)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        return StreamingResponse(
            iter([content]),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="todoai_export_{ts}.json"'},
        )

    # CSV format: zip with projects.csv + tasks.csv
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Projects CSV
        proj_buf = io.StringIO()
        pw = csv.writer(proj_buf)
        pw.writerow(["id", "parent_project_id", "category", "name", "color", "created_at"])
        for p in projects:
            pw.writerow([p.id, p.parent_project_id or "", p.category or "", p.name, p.color, p.created_at.isoformat() if p.created_at else ""])
        zf.writestr("projects.csv", proj_buf.getvalue())

        # Tasks CSV
        task_buf = io.StringIO()
        tw = csv.writer(task_buf)
        tw.writerow(["id", "project_id", "parent_task_id", "title", "notes", "status", "due_at", "impact", "effort", "priority", "tags", "estimate_min", "position", "created_at"])
        for t in tasks:
            tw.writerow([
                t.id, t.project_id or "", t.parent_task_id or "", t.title, t.notes or "",
                t.status, t.due_at.isoformat() if t.due_at else "", t.impact, t.effort,
                t.priority, ";".join(t.tags or []), t.estimate_min, t.position,
                t.created_at.isoformat() if t.created_at else "",
            ])
        zf.writestr("tasks.csv", task_buf.getvalue())

    buf.seek(0)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="todoai_export_{ts}.zip"'},
    )
