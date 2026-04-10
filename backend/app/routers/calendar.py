from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.calendar_link import CalendarLink
from ..models.task import Task
from ..schemas import CalendarEventCreate, CalendarEventUpdate, CalendarEventOut
from ..services import calendar as cal_service
from ..services.audit import log_action

router = APIRouter(prefix="/calendar", tags=["calendar"])


@router.get("/agenda")
def read_agenda(
    start: datetime = Query(...),
    end: datetime = Query(...),
    calendar_id: str = Query("primary"),
):
    try:
        events = cal_service.read_agenda(start, end, calendar_id)
        return {"events": events}
    except RuntimeError as e:
        raise HTTPException(503, str(e))


@router.post("/events", response_model=CalendarEventOut, status_code=201)
def create_event(data: CalendarEventCreate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == data.task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(404, "Task not found")

    existing = db.query(CalendarLink).filter(CalendarLink.task_id == data.task_id).first()
    if existing:
        raise HTTPException(409, "Task already linked to a calendar event")

    try:
        event = cal_service.create_event(task.title, data.start_at, data.end_at, data.calendar_id)
    except RuntimeError as e:
        raise HTTPException(503, str(e))

    link = CalendarLink(
        task_id=data.task_id,
        gcal_event_id=event["id"],
        start_at=data.start_at,
        end_at=data.end_at,
        calendar_id=data.calendar_id,
    )
    db.add(link)
    log_action(db, "calendar_link", "task", data.task_id, {"gcal_event_id": event["id"]})
    db.commit()
    db.refresh(link)
    return link


@router.patch("/events/{task_id}", response_model=CalendarEventOut)
def update_event(task_id: str, data: CalendarEventUpdate, db: Session = Depends(get_db)):
    link = db.query(CalendarLink).filter(CalendarLink.task_id == task_id).first()
    if not link:
        raise HTTPException(404, "No calendar link for this task")

    try:
        cal_service.update_event(
            link.gcal_event_id,
            start=data.start_at,
            end=data.end_at,
            calendar_id=link.calendar_id,
        )
    except RuntimeError as e:
        raise HTTPException(503, str(e))

    if data.start_at:
        link.start_at = data.start_at
    if data.end_at:
        link.end_at = data.end_at
    log_action(db, "calendar_update", "task", task_id)
    db.commit()
    db.refresh(link)
    return link
