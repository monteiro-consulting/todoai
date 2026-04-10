from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.audit_log import AuditLog
from ..schemas import AuditLogOut

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[AuditLogOut])
def list_audit_logs(
    entity_type: str | None = Query(None),
    entity_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(AuditLog)
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        q = q.filter(AuditLog.entity_id == entity_id)
    return q.order_by(AuditLog.created_at.desc()).limit(limit).all()
