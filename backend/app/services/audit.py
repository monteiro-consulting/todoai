from sqlalchemy.orm import Session
from ..models.audit_log import AuditLog


def log_action(db: Session, action: str, entity_type: str, entity_id: str, diff: dict | None = None):
    entry = AuditLog(
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        diff_json=diff,
    )
    db.add(entry)
    db.flush()


def _json_safe(val):
    from datetime import datetime, date
    if isinstance(val, datetime):
        return val.isoformat()
    if isinstance(val, date):
        return val.isoformat()
    return val


def compute_diff(old: dict, new: dict) -> dict:
    diff = {}
    for key in new:
        if key in old and old[key] != new[key]:
            diff[key] = {"old": _json_safe(old[key]), "new": _json_safe(new[key])}
    return diff
