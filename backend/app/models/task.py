import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Integer, Float, Text, ForeignKey, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base


class TaskDependency(Base):
    """Many-to-many: task_id depends on depends_on_id (depends_on must be done first)."""
    __tablename__ = "task_dependencies"

    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), primary_key=True)
    depends_on_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class TaskTrigger(Base):
    """Link table: when source_task is completed, it contributes to triggering target_task."""
    __tablename__ = "task_triggers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)
    target_task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    source_task = relationship("Task", foreign_keys=[source_task_id], back_populates="triggers_out")
    target_task = relationship("Task", foreign_keys=[target_task_id], back_populates="triggers_in")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("projects.id"), nullable=True)
    parent_task_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open")
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    impact: Mapped[int] = mapped_column(Integer, default=3)
    effort: Mapped[int] = mapped_column(Integer, default=3)
    priority: Mapped[int] = mapped_column(Integer, default=3)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    estimate_min: Mapped[int] = mapped_column(Integer, default=30)
    position: Mapped[int] = mapped_column(Integer, default=0)
    # Legacy field - kept for DB compat, no longer used in logic
    triggers_goai_task_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tasks.id", use_alter=True), nullable=True)
    critical: Mapped[bool] = mapped_column(default=False)
    # Trigger settings on this task (as a target)
    trigger_mode: Mapped[str] = mapped_column(String(10), default="or")  # "or" | "and"
    trigger_goai: Mapped[bool] = mapped_column(default=False)  # whether triggering sends to GoAi
    is_deleted: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    project = relationship("Project", back_populates="tasks")
    subtasks = relationship("Task", back_populates="parent_task", foreign_keys=[parent_task_id], lazy="selectin")
    parent_task = relationship("Task", remote_side=[id], foreign_keys=[parent_task_id], back_populates="subtasks")
    triggers_goai_task = relationship("Task", foreign_keys=[triggers_goai_task_id], remote_side=[id], uselist=False)
    calendar_link = relationship("CalendarLink", back_populates="task", uselist=False, lazy="selectin")

    # New trigger relationships
    triggers_out = relationship("TaskTrigger", foreign_keys=[TaskTrigger.source_task_id], back_populates="source_task", lazy="selectin", cascade="all, delete-orphan")
    triggers_in = relationship("TaskTrigger", foreign_keys=[TaskTrigger.target_task_id], back_populates="target_task", lazy="selectin", cascade="all, delete-orphan")

    # Dependencies (many-to-many via TaskDependency)
    dependencies = relationship(
        "Task",
        secondary="task_dependencies",
        primaryjoin="Task.id == TaskDependency.task_id",
        secondaryjoin="Task.id == TaskDependency.depends_on_id",
        backref="dependents",
        lazy="selectin",
    )

    def compute_score(self) -> float:
        import math

        impact = self.impact or 3
        effort = self.effort or 3
        priority = self.priority or 3
        estimate = self.estimate_min or 30

        # 1) Base: impact weighted against effort
        base = (impact * 2) - effort  # range: -3 to +9

        # 2) Priority multiplier: priority 1=x0.6, 3=x1.0, 5=x1.4
        priority_mult = 0.6 + (priority - 1) * 0.2

        # 3) Quick-win bonus: short tasks get a boost (favors < 30min)
        #    estimate 5min -> +2.0, 15min -> +1.5, 30min -> +1.0, 60min -> +0.5, 120min+ -> 0
        quick_win = max(0.0, 2.0 - (estimate / 30.0))

        # 4) Deadline urgency: progressive curve instead of fixed thresholds
        #    Closer deadline = higher bonus, max +4.0
        deadline_bonus = 0.0
        if self.due_at:
            now = datetime.utcnow()
            due = self.due_at.replace(tzinfo=None) if self.due_at.tzinfo else self.due_at
            hours_left = (due - now).total_seconds() / 3600
            if hours_left <= 0:
                deadline_bonus = 4.0  # overdue
            elif hours_left < 168:  # within 7 days
                # exponential decay: 4 * e^(-hours/48)
                deadline_bonus = round(4.0 * math.exp(-hours_left / 48), 2)

        self.score = round(base * priority_mult + quick_win + deadline_bonus, 2)
        return self.score
