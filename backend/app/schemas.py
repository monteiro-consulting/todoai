from datetime import datetime
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional


# --- Projects ---
class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    color: str = Field(default="#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")
    parent_project_id: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    local_path: Optional[str] = None

class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    color: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    parent_project_id: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    local_path: Optional[str] = None

class ProjectOut(BaseModel):
    id: str
    parent_project_id: Optional[str] = None
    category: Optional[str] = None
    name: str
    color: str
    notes: Optional[str] = None
    local_path: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    subprojects: list["ProjectOut"] = []
    model_config = {"from_attributes": True}


# --- Task Triggers ---
class TaskTriggerCreate(BaseModel):
    source_task_id: str
    target_task_id: str

class TaskTriggerOut(BaseModel):
    id: str
    source_task_id: str
    target_task_id: str
    created_at: datetime
    model_config = {"from_attributes": True}


# --- Task Dependencies ---
class TaskDependencyCreate(BaseModel):
    task_id: str
    depends_on_id: str

class AddDependencyRequest(BaseModel):
    """Body for POST /tasks/{id}/dependencies — task_id comes from URL."""
    depends_on_id: str

class TaskDependencyOut(BaseModel):
    task_id: str
    depends_on_id: str
    created_at: datetime
    model_config = {"from_attributes": True}


class TaskRef(BaseModel):
    """Lightweight task reference for dependency lists (avoids recursive TaskOut)."""
    id: str
    title: str
    status: str
    project_id: Optional[str] = None
    model_config = {"from_attributes": True}


# --- Dependency Graph ---
class GraphNode(BaseModel):
    id: str
    title: str
    status: str
    project_id: Optional[str] = None
    impact: int = 1
    effort: int = 1
    due_at: Optional[datetime] = None

class GraphEdge(BaseModel):
    source: str
    target: str
    type: str  # "dependency" | "trigger"

class DependencyGraphOut(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


# --- Tasks ---
class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    project_id: Optional[str] = None
    parent_task_id: Optional[str] = None
    notes: Optional[str] = None
    status: str = Field(default="open", pattern=r"^(open|waiting|in_progress|goai|done|archived)$")
    due_at: Optional[datetime] = None
    impact: int = Field(default=3, ge=1, le=5)
    effort: int = Field(default=3, ge=1, le=5)
    priority: int = Field(default=3, ge=1, le=5)
    tags: list[str] = Field(default_factory=list)
    estimate_min: int = Field(default=30, ge=1, le=480)
    position: int = Field(default=0, ge=0)
    triggers_goai_task_id: Optional[str] = None
    critical: bool = False
    trigger_mode: str = Field(default="or", pattern=r"^(or|and)$")
    trigger_goai: bool = False

class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    project_id: Optional[str] = None
    parent_task_id: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = Field(None, pattern=r"^(open|waiting|in_progress|goai|done|archived)$")
    due_at: Optional[datetime] = None
    impact: Optional[int] = Field(None, ge=1, le=5)
    effort: Optional[int] = Field(None, ge=1, le=5)
    priority: Optional[int] = Field(None, ge=1, le=5)
    tags: Optional[list[str]] = None
    estimate_min: Optional[int] = Field(None, ge=1, le=480)
    position: Optional[int] = Field(None, ge=0)
    triggers_goai_task_id: Optional[str] = None
    critical: Optional[bool] = None
    trigger_mode: Optional[str] = Field(None, pattern=r"^(or|and)$")
    trigger_goai: Optional[bool] = None

class TaskOut(BaseModel):
    id: str
    project_id: Optional[str]
    parent_task_id: Optional[str]
    title: str
    notes: Optional[str]
    status: str
    due_at: Optional[datetime]
    impact: int
    effort: int
    priority: int
    score: float
    tags: list[str]
    estimate_min: int
    position: int
    triggers_goai_task_id: Optional[str] = None
    critical: bool = False
    trigger_mode: str = "or"
    trigger_goai: bool = False
    created_at: datetime
    updated_at: datetime
    subtasks: list["TaskOut"] = []
    triggers_in: list[TaskTriggerOut] = []
    triggers_out: list[TaskTriggerOut] = []
    dependencies: list[TaskRef] = []
    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_filtered(cls, task):
        """Create TaskOut filtering out deleted subtasks recursively."""
        data = cls.model_validate(task)
        data.subtasks = [
            cls.from_orm_filtered(st)
            for st in (task.subtasks or [])
            if not st.is_deleted
        ]
        return data


class CompleteTaskOut(BaseModel):
    """Response for task completion, includes triggered tasks."""
    task: TaskOut
    triggered_tasks: list[TaskOut] = []
    next_goai_task: Optional[TaskOut] = None

class BulkTaskCreate(BaseModel):
    tasks: list[TaskCreate] = Field(..., max_length=50)

class DumpCreate(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    project_id: Optional[str] = None


# --- Audit ---
class AuditLogOut(BaseModel):
    id: str
    action: str
    entity_type: str
    entity_id: str
    diff_json: Optional[dict]
    created_at: datetime
    model_config = {"from_attributes": True}


# --- Calendar ---
class CalendarEventCreate(BaseModel):
    task_id: str
    start_at: datetime
    end_at: datetime
    calendar_id: str = "primary"

class CalendarEventUpdate(BaseModel):
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None

class CalendarEventOut(BaseModel):
    task_id: str
    gcal_event_id: str
    start_at: datetime
    end_at: datetime
    calendar_id: str
    model_config = {"from_attributes": True}


# --- Plan ---
class PlanGenerateRequest(BaseModel):
    """Request to generate subtasks (plan) for a parent task before coding."""
    project_name: Optional[str] = None
    project_notes: Optional[str] = None

class PlanGenerateOut(BaseModel):
    """Response from plan generation: the created subtasks."""
    parent_task_id: str
    subtasks: list["TaskOut"]
    count: int

class SubtaskProposal(BaseModel):
    """A proposed subtask from AI plan generation (not yet created)."""
    title: str
    notes: Optional[str] = None
    impact: int = Field(default=3, ge=1, le=5)
    effort: int = Field(default=3, ge=1, le=5)
    estimate_min: int = Field(default=30, ge=5, le=480)
    tags: list[str] = Field(default_factory=list)

class PlanPreviewOut(BaseModel):
    """Response from plan preview: proposed subtasks for review before creation."""
    parent_task_id: str
    proposals: list[SubtaskProposal]
    count: int

class PlanConfirmRequest(BaseModel):
    """Request to confirm and create reviewed subtasks."""
    subtasks: list[SubtaskProposal] = Field(..., min_length=1, max_length=20)

# --- Suggestions ---
class SuggestRequest(BaseModel):
    """Request to generate task suggestions based on existing context."""
    project_id: Optional[str] = None

class TaskSuggestion(BaseModel):
    """A suggested task from AI analysis."""
    title: str
    reason: str = ""
    impact: int = Field(default=3, ge=1, le=5)
    effort: int = Field(default=3, ge=1, le=5)
    estimate_min: int = Field(default=30, ge=5, le=480)
    tags: list[str] = Field(default_factory=list)
    project_id: Optional[str] = None

class SuggestionsOut(BaseModel):
    """Response from suggestion generation."""
    suggestions: list[TaskSuggestion]
    count: int


# --- Stack Detection ---
class DependenciesOut(BaseModel):
    production: list[str] = Field(default_factory=list)
    dev: list[str] = Field(default_factory=list)

class StackDetectionOut(BaseModel):
    """Detected tech stack, project type, and dependencies for a local project."""
    project_types: list[str] = Field(default_factory=list)
    primary_language: str = "unknown"
    languages: list[str] = Field(default_factory=list)
    frameworks: list[str] = Field(default_factory=list)
    build_tools: list[str] = Field(default_factory=list)
    test_tools: list[str] = Field(default_factory=list)
    styling: list[str] = Field(default_factory=list)
    orm_db: list[str] = Field(default_factory=list)
    infrastructure: list[str] = Field(default_factory=list)
    package_managers: list[str] = Field(default_factory=list)
    dependencies: DependenciesOut = Field(default_factory=DependenciesOut)
    meta: dict = Field(default_factory=dict)
    error: Optional[str] = None


class PlanTodayRequest(BaseModel):
    available_minutes: int = Field(default=480, ge=30, le=960)
    focus_project_id: Optional[str] = None

class PlannedTask(BaseModel):
    task_id: str
    title: str
    start_at: datetime
    end_at: datetime
    score: float

class PlanTodayOut(BaseModel):
    tasks: list[PlannedTask]
    total_minutes: int
    remaining_minutes: int
