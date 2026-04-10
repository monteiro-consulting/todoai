from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..schemas import PlanTodayRequest, PlanTodayOut
from ..services.planner import plan_today

router = APIRouter(prefix="/plan", tags=["plan"])


@router.post("/today", response_model=PlanTodayOut)
def generate_plan(data: PlanTodayRequest, db: Session = Depends(get_db)):
    result = plan_today(db, data.available_minutes, data.focus_project_id)
    return result
