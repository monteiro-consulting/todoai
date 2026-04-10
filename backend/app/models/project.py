import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    parent_project_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("projects.id"), nullable=True, default=None)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True, default=None)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    color: Mapped[str] = mapped_column(String(7), default="#6366f1")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    local_path: Mapped[str | None] = mapped_column(String(1024), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    is_deleted: Mapped[bool] = mapped_column(default=False)

    tasks = relationship("Task", back_populates="project", lazy="selectin")
    subprojects = relationship("Project", back_populates="parent_project", lazy="selectin",
                               foreign_keys="[Project.parent_project_id]")
    parent_project = relationship("Project", remote_side="[Project.id]",
                                  foreign_keys="[Project.parent_project_id]")
