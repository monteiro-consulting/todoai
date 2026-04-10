from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base


class CalendarLink(Base):
    __tablename__ = "calendar_links"

    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), primary_key=True)
    gcal_event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    calendar_id: Mapped[str] = mapped_column(String(255), default="primary")

    task = relationship("Task", back_populates="calendar_link")
