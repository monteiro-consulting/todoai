import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useProjectMap } from "../contexts/ProjectContext";
import { api } from "../api/client";
import { formatDueDate } from "../utils/dateFormat";
import { launchGoAi } from "../utils/goai";
import ConfirmModal from "./ConfirmModal";
import TriggerPickerModal from "./TriggerPickerModal";
import type { Task } from "../types";

interface Props {
  tasks: Task[];
  onUpdate: () => void;
}

type Column = "open" | "waiting" | "in_progress" | "goai" | "done";

const COLUMNS: { key: Column; label: string }[] = [
  { key: "open", label: "To Do" },
  { key: "waiting", label: "Waiting" },
  { key: "in_progress", label: "In Progress" },
  { key: "goai", label: "GoAi" },
  { key: "done", label: "Done" },
];

function countSubtasks(task: Task): number {
  let count = 0;
  for (const s of task.subtasks || []) {
    count += 1 + countSubtasks(s);
  }
  return count;
}

function scoreClass(score: number) {
  if (score >= 6) return "score-critical";
  if (score >= 4) return "score-high";
  if (score >= 2) return "score-mid";
  return "score-low";
}

export default function KanbanBoard({ tasks, onUpdate }: Props) {
  const navigate = useNavigate();
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; task: Task } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const projectMap = useProjectMap();

  const columns = useMemo(() => {
    const map: Record<Column, Task[]> = { open: [], waiting: [], in_progress: [], goai: [], done: [] };
    for (const t of tasks) {
      if (t.status === "archived") continue;
      const col = t.status as Column;
      if (map[col]) map[col].push(t);
      else map.open.push(t);
    }
    for (const key of Object.keys(map) as Column[]) {
      map[key].sort((a, b) => b.score - a.score);
    }
    return map;
  }, [tasks]);

  // Pointer-based drag state
  const [dragging, setDragging] = useState<{ task: Task; startX: number; startY: number } | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverCol, setHoverCol] = useState<Column | null>(null);
  const colRefs = useRef<Record<Column, HTMLDivElement | null>>({ open: null, waiting: null, in_progress: null, goai: null, done: null });
  const dragStarted = useRef(false);
  const clickBlocked = useRef(false);
  const [criticalConfirm, setCriticalConfirm] = useState<{ task: Task; targetCol: Column } | null>(null);
  const [waitingPicker, setWaitingPicker] = useState<Task | null>(null);

  const getColumnAtPoint = useCallback((x: number, y: number): Column | null => {
    for (const col of COLUMNS) {
      const el = colRefs.current[col.key];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return col.key;
      }
    }
    return null;
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, task: Task) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging({ task, startX: e.clientX, startY: e.clientY });
    dragStarted.current = false;
    clickBlocked.current = false;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.startX;
    const dy = e.clientY - dragging.startY;
    if (!dragStarted.current && Math.abs(dx) + Math.abs(dy) < 6) return;
    dragStarted.current = true;
    clickBlocked.current = true;
    setGhostPos({ x: e.clientX, y: e.clientY });
    setHoverCol(getColumnAtPoint(e.clientX, e.clientY));
  }, [dragging, getColumnAtPoint]);

  const handleWaitingConfirm = useCallback(async (task: Task, sourceTaskIds: string[]) => {
    try {
      // Add trigger links: each selected source triggers this task
      for (const sourceId of sourceTaskIds) {
        await api.addTrigger({ source_task_id: sourceId, target_task_id: task.id });
      }
      // The backend auto-sets the task to "waiting" when a trigger is added,
      // but ensure it's set in case it was already waiting
      await api.updateTask(task.id, { status: "waiting" });
      onUpdate();
    } catch (err) {
      console.error("Failed to set waiting triggers:", err);
    }
  }, [onUpdate]);

  const moveTaskToColumn = useCallback(async (task: Task, targetCol: Column) => {
    try {
      if (targetCol === "done") {
        const result = await api.completeTask(task.id);
        for (const tr of result.triggered_tasks || []) {
          if (tr.trigger_goai) {
            launchGoAi(tr, projectMap);
          }
        }
      } else {
        await api.updateTask(task.id, { status: targetCol });
      }
      if (targetCol === "goai") {
        const fresh = await api.getTask(task.id);
        launchGoAi(fresh, projectMap);
      }
      onUpdate();
    } catch (err) {
      console.error("Failed to update task status:", err);
    }
  }, [onUpdate, projectMap]);

  const handlePointerUp = useCallback(async (e: React.PointerEvent) => {
    if (!dragging) return;
    const task = dragging.task;
    const wasDragging = dragStarted.current;
    setDragging(null);
    setGhostPos(null);
    setHoverCol(null);
    dragStarted.current = false;

    if (!wasDragging) return;

    const targetCol = getColumnAtPoint(e.clientX, e.clientY);
    if (!targetCol || targetCol === task.status) return;

    // Confirm before completing critical tasks
    if (targetCol === "done" && task.critical) {
      setCriticalConfirm({ task, targetCol });
      return;
    }

    // Ask which task triggers this one when dropping into waiting
    if (targetCol === "waiting") {
      setWaitingPicker(task);
      return;
    }

    moveTaskToColumn(task, targetCol);
  }, [dragging, getColumnAtPoint, moveTaskToColumn]);

  // Prevent click navigation after drag
  const handleCardClick = useCallback((taskId: string) => {
    if (clickBlocked.current) {
      clickBlocked.current = false;
      return;
    }
    navigate(`/task/${taskId}`);
  }, [navigate]);

  // Clean up on unmount / escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (dragging) {
          setDragging(null);
          setGhostPos(null);
          setHoverCol(null);
          dragStarted.current = false;
        }
        setCtxMenu(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dragging]);

  // Close context menu on click outside
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  const handleCtxEdit = () => {
    if (ctxMenu) navigate(`/task/${ctxMenu.task.id}`);
    setCtxMenu(null);
  };

  const handleCtxGoAi = async () => {
    if (!ctxMenu) return;
    const t = ctxMenu.task;
    setCtxMenu(null);
    try {
      await api.updateTask(t.id, { status: "goai" });
      // Re-fetch to get subtasks
      const fresh = await api.getTask(t.id);
      await launchGoAi(fresh, projectMap);
      onUpdate();
    } catch (err) {
      console.error("Failed to launch GoAi:", err);
    }
  };

  const handleCtxCopy = () => {
    if (ctxMenu) navigator.clipboard.writeText(ctxMenu.task.title);
    setCtxMenu(null);
  };

  const handleCtxDuplicate = async () => {
    if (!ctxMenu) return;
    const t = ctxMenu.task;
    setCtxMenu(null);
    try {
      await api.createTask({
        title: t.title,
        project_id: t.project_id || null,
        parent_task_id: t.parent_task_id || null,
        impact: t.impact,
        effort: t.effort,
        estimate_min: t.estimate_min,
        tags: [...t.tags],
      });
      onUpdate();
    } catch (err) {
      console.error("Failed to duplicate task:", err);
    }
  };

  const handleCtxDelete = async () => {
    if (!ctxMenu) return;
    const t = ctxMenu.task;
    setCtxMenu(null);
    try {
      await api.deleteTask(t.id);
      onUpdate();
    } catch (err) {
      console.error("Failed to delete task:", err);
    }
  };

  return (
    <div className="kanban-board">
      {COLUMNS.map(({ key, label }) => (
        <div
          key={key}
          ref={(el) => { colRefs.current[key] = el; }}
          className={`kanban-column kanban-col-${key} ${hoverCol === key ? "kanban-col-hover" : ""}`}
        >
          <div className="kanban-column-header">
            <span>{label}</span>
            <span className="kanban-count">{columns[key].length}</span>
          </div>
          <div className="kanban-cards">
            {columns[key].map((task) => {
              const project = task.project_id ? projectMap[task.project_id] : null;
              const dueInfo = formatDueDate(task.due_at, task.status);
              const isDragSource = dragging?.task.id === task.id && dragStarted.current;
              return (
                <div
                  key={task.id}
                  className={`kanban-card ${isDragSource ? "kanban-card-dragging" : ""}`}
                  onPointerDown={(e) => handlePointerDown(e, task)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onClick={() => handleCardClick(task.id)}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, task }); }}
                  style={{ touchAction: "none" }}
                >
                  {project && (
                    <div className="kanban-card-project">
                      <span className="kanban-card-dot" style={{ backgroundColor: project.color }} />
                      <span style={{ color: project.color }}>{project.name}</span>
                    </div>
                  )}
                  <div className="kanban-card-title">{task.title}</div>
                  {countSubtasks(task) > 0 && (
                    <div className="kanban-card-subtasks">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                      {countSubtasks(task)}
                    </div>
                  )}
                  <div className="kanban-card-footer">
                    {dueInfo && (
                      <span className={`due-badge ${dueInfo.className}`}>{dueInfo.label}</span>
                    )}
                    <div className="kanban-card-tags">
                      {task.tags.slice(0, 3).map((t) => (
                        <span key={t} className="tag">{t}</span>
                      ))}
                      {task.tags.length > 3 && (
                        <span className="tag-more">+{task.tags.length - 3}</span>
                      )}
                    </div>
                    {task.status !== "done" && (
                      <span className={`score-badge ${scoreClass(task.score)}`}>{task.score.toFixed(1)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Context menu */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          <button onClick={handleCtxEdit}>Edit</button>
          <button className="ctx-goai" onClick={handleCtxGoAi}>GoAi</button>
          <button onClick={handleCtxCopy}>Copy</button>
          <button onClick={handleCtxDuplicate}>Duplicate</button>
          <button className="ctx-danger" onClick={handleCtxDelete}>Delete</button>
        </div>
      )}

      {/* Drag ghost */}
      {ghostPos && dragging && dragStarted.current && (
        <div
          className="kanban-ghost"
          style={{ left: ghostPos.x, top: ghostPos.y }}
        >
          {dragging.task.title}
        </div>
      )}

      {criticalConfirm && (
        <ConfirmModal
          title="Critical Task"
          message={`"${criticalConfirm.task.title}" is marked as critical. Are you sure you want to mark it as done?`}
          confirmLabel="Mark as Done"
          cancelLabel="Cancel"
          danger
          onConfirm={() => { const { task, targetCol } = criticalConfirm; setCriticalConfirm(null); moveTaskToColumn(task, targetCol); }}
          onCancel={() => setCriticalConfirm(null)}
        />
      )}

      {waitingPicker && (
        <TriggerPickerModal
          task={waitingPicker}
          onConfirm={(sourceIds) => { const task = waitingPicker; setWaitingPicker(null); handleWaitingConfirm(task, sourceIds); }}
          onCancel={() => setWaitingPicker(null)}
        />
      )}

    </div>
  );
}
