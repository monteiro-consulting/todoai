import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../api/client";
import { formatDueDate } from "../utils/dateFormat";
import { useProjectMap } from "../contexts/ProjectContext";
import { useUndo } from "../contexts/UndoContext";
import ConfirmModal from "./ConfirmModal";
import GoAiPlanFlow from "./GoAiPlanFlow";
import type { Task, SortMode } from "../types";

interface Props {
  task: Task;
  onUpdate: () => void;
  depth?: number;
  sortMode?: SortMode;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  /** When set, show a drop indicator line at this depth */
  dropLineDepth?: number;
  /** Whether the drop line appears above or below the task */
  dropLinePosition?: "above" | "below";
}

function scoreClass(score: number) {
  if (score >= 6) return "score-critical";
  if (score >= 4) return "score-high";
  if (score >= 2) return "score-mid";
  return "score-low";
}

export default function TaskItem({ task, onUpdate, depth = 0, sortMode, isExpanded, onToggleExpand, dropLineDepth, dropLinePosition = "above" }: Props) {
  const navigate = useNavigate();
  const projectMap = useProjectMap();
  const { pushUndo } = useUndo();
  const [localExpanded, setLocalExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [completing, setCompleting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [showCriticalConfirm, setShowCriticalConfirm] = useState(false);
  const [goaiFlowTask, setGoaiFlowTask] = useState<Task | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const project = task.project_id ? projectMap[task.project_id] : null;

  // Close context menu on click outside
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const handleDelete = async () => {
    setCtxMenu(null);
    setRemoving(true);
    await new Promise((r) => setTimeout(r, 300));
    const snapshot = { ...task };
    try {
      await api.deleteTask(task.id);
      pushUndo({
        label: "delete task",
        fn: async () => {
          await api.createTask({
            title: snapshot.title,
            project_id: snapshot.project_id || null,
            parent_task_id: snapshot.parent_task_id || null,
            impact: snapshot.impact,
            effort: snapshot.effort,
            estimate_min: snapshot.estimate_min,
            tags: snapshot.tags,
          });
        },
      });
      onUpdate();
    } catch (err) {
      setRemoving(false);
      console.error("Failed to delete task:", err);
    }
  };

  const handleEdit = () => {
    setCtxMenu(null);
    navigate(`/task/${task.id}`);
  };

  const handleCopy = () => {
    setCtxMenu(null);
    navigator.clipboard.writeText(task.title);
  };

  const handleDuplicate = async () => {
    setCtxMenu(null);
    try {
      await api.createTask({
        title: task.title,
        project_id: task.project_id || null,
        parent_task_id: task.parent_task_id || null,
        impact: task.impact,
        effort: task.effort,
        estimate_min: task.estimate_min,
        tags: [...task.tags],
      });
      onUpdate();
    } catch (err) {
      console.error("Failed to duplicate task:", err);
    }
  };

  const handleGoAi = async () => {
    setCtxMenu(null);
    try {
      await api.updateTask(task.id, { status: "goai" });
      // Fetch fresh task data with subtasks for plan-first flow
      const fresh = await api.getTask(task.id);
      setGoaiFlowTask(fresh);
    } catch (err) {
      console.error("Failed to launch GoAi:", err);
    }
  };

  const flatMode = onToggleExpand !== undefined;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const expanded = flatMode ? isExpanded : localExpanded;

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (flatMode) onToggleExpand?.();
    else setLocalExpanded(!localExpanded);
  };

  const doComplete = async () => {
    const prevStatus = task.status;
    if (prevStatus !== "done") {
      setCompleting(true);
      setTimeout(() => setCompleting(false), 400);
    }
    if (prevStatus === "done") {
      await api.updateTask(task.id, { status: "open" });
      pushUndo({
        label: "reopen task",
        fn: async () => { await api.completeTask(task.id); },
      });
    } else {
      const result = await api.completeTask(task.id);
      pushUndo({
        label: "complete task",
        fn: async () => { await api.updateTask(task.id, { status: prevStatus }); },
      });
      // Auto-chain: launch triggered GoAi tasks with plan-first flow
      const goaiTriggered = (result.triggered_tasks || []).find((tr: any) => tr.trigger_goai);
      if (goaiTriggered) {
        const fresh = await api.getTask(goaiTriggered.id);
        setGoaiFlowTask(fresh);
      }
    }
    onUpdate();
  };

  const toggleComplete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Confirm before completing critical tasks
    if (task.status !== "done" && task.critical) {
      setShowCriticalConfirm(true);
      return;
    }
    doComplete();
  };

  const handleAddSubtask = async () => {
    if (!newTitle.trim()) return;
    try {
      await api.createTask({
        title: newTitle.trim(),
        parent_task_id: task.id,
        project_id: task.project_id || null,
      });
      setNewTitle("");
      setAdding(false);
      onUpdate();
    } catch (err) {
      console.error("Failed to create subtask:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleAddSubtask(); }
    if (e.key === "Escape") { setAdding(false); setNewTitle(""); }
  };

  const doneCount = hasSubtasks ? task.subtasks.filter((s) => s.status === "done").length : 0;
  const totalCount = hasSubtasks ? task.subtasks.length : 0;
  const dueInfo = formatDueDate(task.due_at, task.status);

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {/* Drop indicator line - above */}
      {dropLineDepth !== undefined && dropLinePosition === "above" && (
        <div className="drop-line" style={{ marginLeft: `calc(${dropLineDepth} * var(--task-indent, 50px))` }} />
      )}

      <div
        className={`task-item ${task.status === "done" ? "done" : ""} ${task.status === "waiting" ? "waiting" : ""} ${isDragging ? "dragging" : ""} ${completing ? "completing" : ""} ${removing ? "removing" : ""}`}
        style={{ marginLeft: `calc(${depth} * var(--task-indent, 50px))` }}
        onClick={() => navigate(`/task/${task.id}`)}
        onContextMenu={handleContextMenu}
      >
        <span
          className="drag-handle"
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >⠿</span>

        <div
          className={`checkbox ${task.status === "done" ? "checked" : ""}`}
          style={project ? { borderColor: project.color, ...(task.status === "done" ? { background: project.color } : {}) } : undefined}
          onClick={toggleComplete}
        >
          {task.status === "done" && "✓"}
        </div>

        {hasSubtasks && (
          <span className="expand-toggle" onClick={handleToggleExpand}>
            {expanded ? "▾" : "▸"}
          </span>
        )}

        {task.critical && (
          <span title="Critical" style={{ color: "var(--red, #ef4444)", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>!</span>
        )}

        <span className="task-title">
          <span className="task-title-text">{task.title}</span>
          {task.notes && (
            <span className="task-context-preview">{task.notes.length > 80 ? task.notes.slice(0, 80) + "…" : task.notes}</span>
          )}
        </span>

        {hasSubtasks && (
          <span className="subtask-count">{doneCount}/{totalCount}</span>
        )}

        <div className="task-tags">
          {task.tags.map((t) => (
            <span key={t} className="tag">{t}</span>
          ))}
        </div>

        {dueInfo && (
          <span className={`due-badge ${dueInfo.className}`}>{dueInfo.label}</span>
        )}

        {task.triggers_out && task.triggers_out.length > 0 && (
          <span title="Triggers tasks on complete" style={{ fontSize: 11, color: "var(--accent)", display: "flex", alignItems: "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        )}
        {task.triggers_in && task.triggers_in.length > 0 && (
          <span title={`Triggered by ${task.triggers_in.length} task(s) (${task.trigger_mode.toUpperCase()})`} style={{ fontSize: 11, color: "var(--green)", display: "flex", alignItems: "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </span>
        )}

        {task.estimate_min > 0 && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{task.estimate_min}m</span>
        )}
        {task.status !== "done" && <span className={`score-badge ${scoreClass(task.score)}`}>{task.score.toFixed(1)}</span>}

        {task.status !== "done" && task.status !== "goai" && (
          <span
            className="goai-btn"
            title="Send to GoAi"
            onClick={(e) => { e.stopPropagation(); handleGoAi(); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
              <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
              <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
              <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
            </svg>
          </span>
        )}

        <span
          className="add-subtask-btn"
          title="Add subtask"
          onClick={(e) => { e.stopPropagation(); setAdding(!adding); }}
        >+</span>
      </div>

      {ctxMenu && (
        <div
          ref={ctxRef}
          className="ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          <button onClick={handleEdit}>Edit</button>
          <button className="ctx-goai" onClick={handleGoAi}>GoAi</button>
          <button onClick={handleCopy}>Copy</button>
          <button onClick={handleDuplicate}>Duplicate</button>
          <button className="ctx-danger" onClick={handleDelete}>Delete</button>
        </div>
      )}

      {/* Drop indicator line - below */}
      {dropLineDepth !== undefined && dropLinePosition === "below" && (
        <div className="drop-line" style={{ marginLeft: `calc(${dropLineDepth} * var(--task-indent, 50px))` }} />
      )}

      {adding && (
        <div className="subtask-add-row" style={{ marginLeft: `calc(${depth + 1} * var(--task-indent, 50px))` }}>
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Subtask title... (Enter to add, Esc to cancel)"
          />
          <button onClick={handleAddSubtask} disabled={!newTitle.trim()}>Add</button>
          <button className="secondary" onClick={() => { setAdding(false); setNewTitle(""); }}>Cancel</button>
        </div>
      )}

      {!flatMode && hasSubtasks && expanded && (
        <div className="subtasks" style={{ marginLeft: `calc(${depth + 1} * var(--task-indent, 50px))` }}>
          {task.subtasks.map((st) => (
            <TaskItem key={st.id} task={st} onUpdate={onUpdate} depth={depth + 1} />
          ))}
        </div>
      )}

      {showCriticalConfirm && (
        <ConfirmModal
          title="Critical Task"
          message={`"${task.title}" is marked as critical. Are you sure you want to mark it as done?`}
          confirmLabel="Mark as Done"
          cancelLabel="Cancel"
          danger
          onConfirm={() => { setShowCriticalConfirm(false); doComplete(); }}
          onCancel={() => setShowCriticalConfirm(false)}
        />
      )}

      {goaiFlowTask && (
        <GoAiPlanFlow
          task={goaiFlowTask}
          onDone={() => { setGoaiFlowTask(null); onUpdate(); }}
        />
      )}
    </div>
  );
}
