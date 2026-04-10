from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.project import Project
from ..schemas import ProjectCreate, ProjectUpdate, ProjectOut, StackDetectionOut
from ..services.audit import log_action, compute_diff

router = APIRouter(prefix="/projects", tags=["projects"])

def _notify(request: Request, action: str, entity_id: str = ""):
    request.app.state.notify_change("project", action, entity_id)


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    # Return only root projects; subprojects come nested via the relationship
    return db.query(Project).filter(
        Project.is_deleted == False,
        Project.parent_project_id == None
    ).order_by(Project.created_at).all()


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(data: ProjectCreate, request: Request, db: Session = Depends(get_db)):
    project = Project(name=data.name, color=data.color,
                      parent_project_id=data.parent_project_id,
                      category=data.category, notes=data.notes,
                      local_path=data.local_path)
    db.add(project)
    db.flush()
    log_action(db, "create", "project", project.id)
    db.commit()
    db.refresh(project)
    _notify(request, "create", project.id)
    return project


@router.post("/detect-stack", response_model=StackDetectionOut)
def detect_stack_from_path(path: str = Query(..., description="Absolute path to a project directory")):
    """Detect the tech stack for an arbitrary local path (no project needed)."""
    from ..services.stack_detector import detect_stack

    return detect_stack(path)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: str, data: ProjectUpdate, request: Request, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()
    if not p:
        raise HTTPException(404, "Project not found")
    old = {"name": p.name, "color": p.color, "parent_project_id": p.parent_project_id, "category": p.category, "notes": p.notes, "local_path": p.local_path}
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(p, k, v)
    diff = compute_diff(old, update_data)
    if diff:
        log_action(db, "update", "project", p.id, diff)
    db.commit()
    db.refresh(p)
    _notify(request, "update", p.id)
    return p


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, request: Request, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()
    if not p:
        raise HTTPException(404, "Project not found")
    p.is_deleted = True
    log_action(db, "soft_delete", "project", p.id)
    db.commit()
    _notify(request, "delete", p.id)


@router.get("/{project_id}/stack", response_model=StackDetectionOut)
def detect_project_stack(project_id: str, db: Session = Depends(get_db)):
    """Detect the tech stack, project type, and dependencies for a project's local_path."""
    from ..services.stack_detector import detect_stack

    p = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()
    if not p:
        raise HTTPException(404, "Project not found")
    if not p.local_path:
        raise HTTPException(400, "Project has no local_path configured")
    return detect_stack(p.local_path)
