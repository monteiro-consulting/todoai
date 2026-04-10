import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useProjectMap } from "../contexts/ProjectContext";
import type { Task, TaskTrigger } from "../types";
import TaskForm from "../components/TaskForm";
import TaskItem from "../components/TaskItem";
import KanbanBoard from "../components/KanbanBoard";
import MarkdownRenderer from "../components/MarkdownRenderer";
import GenerateContextButton from "../components/GenerateContextButton";
import GeneratePlanButton from "../components/GeneratePlanButton";
import AutoPlanButton from "../components/AutoPlanButton";
import GoAiPlanFlow from "../components/GoAiPlanFlow";
import PlanFirstFlow from "../components/PlanFirstFlow";
import { taskNeedsPlan } from "../utils/generatePlan";
import { launchGoAi } from "../utils/goai";
import DatePicker from "../components/DatePicker";

type ViewMode = "list" | "kanban";

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const projectMap = useProjectMap();
  const [task, setTask] = useState<Task | null>(null);
  const [editing, setEditing] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "", impact: 3, effort: 3, priority: 3, estimate_min: 30,
    tags: "", due_at: "", status: "open", critical: false,
    trigger_mode: "or" as "or" | "and", trigger_goai: false,
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [goaiFlowTask, setGoaiFlowTask] = useState<Task | null>(null);
  const [planFlowTask, setPlanFlowTask] = useState<Task | null>(null);

  // Trigger picker state
  const [triggerOutSearch, setTriggerOutSearch] = useState("");
  const [triggerOutFocused, setTriggerOutFocused] = useState(false);
  const [triggerInSearch, setTriggerInSearch] = useState("");
  const [triggerInFocused, setTriggerInFocused] = useState(false);

  // Dependency picker state
  const [depSearch, setDepSearch] = useState("");
  const [depFocused, setDepFocused] = useState(false);

  const [view, _setView] = useState<ViewMode>(() => (localStorage.getItem("todoai_view") as ViewMode) || "list");
  const setView = (v: ViewMode) => { _setView(v); localStorage.setItem("todoai_view", v); };

  const load = useCallback(async () => {
    const t = await api.getTask(taskId!);
    setTask(t);
    setNotes(t.notes || "");
    setForm({
      title: t.title,
      impact: t.impact,
      effort: t.effort,
      priority: t.priority,
      estimate_min: t.estimate_min,
      tags: t.tags.join(", "),
      due_at: t.due_at ? t.due_at.slice(0, 16) : "",
      status: t.status,
      critical: t.critical || false,
      trigger_mode: t.trigger_mode || "or",
      trigger_goai: t.trigger_goai || false,
    });
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  // Load all tasks for trigger pickers
  useEffect(() => {
    (async () => {
      const tasks = await api.listTasks({ status: "open" });
      const waitingTasks = await api.listTasks({ status: "waiting" });
      const ipTasks = await api.listTasks({ status: "in_progress" });
      const goaiTasks = await api.listTasks({ status: "goai" });
      setAllTasks([...tasks, ...waitingTasks, ...ipTasks, ...goaiTasks]);
    })();
  }, [taskId]);

  const handleNotesChange = useCallback((value: string) => {
    setNotes(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.updateTask(taskId!, { notes: value || null });
      } catch (err) {
        console.error("Failed to save notes:", err);
      }
    }, 800);
  }, [taskId]);

  const handleSave = async () => {
    setError("");
    const impact = Math.max(1, Math.min(5, form.impact || 3));
    const effort = Math.max(1, Math.min(5, form.effort || 3));
    const priority = Math.max(1, Math.min(5, form.priority || 3));
    const estimate_min = Math.max(1, Math.min(480, form.estimate_min || 30));
    if (!form.title.trim()) { setError("Title is required"); return; }
    try {
      const isCompleting = form.status === "done" && task?.status !== "done";

      await api.updateTask(taskId!, {
        title: form.title.trim(),
        notes: notes || null,
        impact,
        effort,
        priority,
        estimate_min,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        due_at: form.due_at || null,
        critical: form.critical,
        trigger_mode: form.trigger_mode,
        trigger_goai: form.trigger_goai,
        ...(isCompleting ? {} : { status: form.status }),
      });

      if (isCompleting) {
        const result = await api.completeTask(taskId!);
        // Plan-first: show plan flow for triggered GoAi tasks
        const goaiTriggered = (result.triggered_tasks || []).find((tr: any) => tr.trigger_goai);
        if (goaiTriggered) {
          const fresh = await api.getTask(goaiTriggered.id);
          setGoaiFlowTask(fresh);
        }
      }

      setEditing(false);
      if (form.status === "goai" && task?.status !== "goai") {
        // Launch terminal directly with Claude
        const updated = await api.getTask(taskId!);
        await launchGoAi(updated, projectMap);
      } else if (form.status === "in_progress" && task?.status !== "in_progress" && task?.parent_task_id === null) {
        // Plan-first: show plan flow before starting work
        const updated = await api.getTask(taskId!);
        if (taskNeedsPlan(updated)) {
          setPlanFlowTask(updated);
        }
      }
      load();
    } catch (err: any) {
      const msg = err.message || "Failed to save";
      try {
        const idx = msg.indexOf(": ");
        if (idx > 0) {
          const body = JSON.parse(msg.slice(idx + 2));
          if (body.detail && Array.isArray(body.detail)) {
            setError(body.detail.map((d: any) => d.msg).join(", "));
            return;
          }
        }
      } catch {}
      setError(msg);
    }
  };

  const handleDelete = async () => {
    await api.deleteTask(taskId!);
    navigate(-1);
  };

  // Trigger link management
  const handleAddTriggerOut = async (targetId: string) => {
    try {
      await api.addTrigger({ source_task_id: taskId!, target_task_id: targetId });
      setTriggerOutSearch("");
      setTriggerOutFocused(false);
      load();
    } catch (err) {
      console.error("Failed to add trigger:", err);
    }
  };

  const handleAddTriggerIn = async (sourceId: string) => {
    try {
      await api.addTrigger({ source_task_id: sourceId, target_task_id: taskId! });
      setTriggerInSearch("");
      setTriggerInFocused(false);
      load();
    } catch (err) {
      console.error("Failed to add trigger:", err);
    }
  };

  const handleRemoveTrigger = async (triggerId: string) => {
    try {
      await api.removeTrigger(taskId!, triggerId);
      load();
    } catch (err) {
      console.error("Failed to remove trigger:", err);
    }
  };

  // Dependency management
  const handleAddDependency = async (dependsOnId: string) => {
    try {
      await api.addDependency(taskId!, dependsOnId);
      setDepSearch("");
      setDepFocused(false);
      load();
    } catch (err: any) {
      console.error("Failed to add dependency:", err);
    }
  };

  const handleRemoveDependency = async (dependsOnId: string) => {
    try {
      await api.removeDependency(taskId!, dependsOnId);
      load();
    } catch (err: any) {
      console.error("Failed to remove dependency:", err);
    }
  };

  const findTask = (id: string) => allTasks.find((t) => t.id === id);

  if (!task) return <div className="empty-state">Loading...</div>;

  // triggers_out: this task triggers others when completed (source = this task)
  // triggers_in: this task is triggered by others (target = this task)
  const triggersOut = task.triggers_out || [];
  const triggersIn = task.triggers_in || [];

  return (
    <div>
      <button className="secondary" onClick={() => navigate(-1)} style={{ marginBottom: 12 }}>
        &larr; Back
      </button>

      <div className="split-pane">
        {/* Left: Context */}
        <div className="split-left">
          <div className="split-left-header">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              {editing ? (
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Title"
                  style={{ fontSize: 18, fontWeight: 600 }}
                />
              ) : (
                <h2 style={{ fontSize: 18 }}>{task.title}</h2>
              )}
              <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 8 }}>
                {editing ? (
                  <>
                    <button onClick={handleSave}>Save</button>
                    <button className="secondary" onClick={() => setEditing(false)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditing(true)}>Edit</button>
                    <button className="danger" onClick={handleDelete}>Delete</button>
                  </>
                )}
              </div>
            </div>
          </div>

          {editing && (
            <div className="task-edit-fields">
              {/* Scoring */}
              <div className="edit-section">
                <div className="edit-section-label">Scoring</div>
                <div className="edit-grid-3">
                  <div className="slider-field">
                    <label>Impact <span>{form.impact}</span></label>
                    <input type="range" min={1} max={5} value={form.impact} onChange={(e) => setForm({ ...form, impact: +e.target.value })} />
                  </div>
                  <div className="slider-field">
                    <label>Effort <span>{form.effort}</span></label>
                    <input type="range" min={1} max={5} value={form.effort} onChange={(e) => setForm({ ...form, effort: +e.target.value })} />
                  </div>
                  <div className="slider-field">
                    <label>Priority <span>{form.priority}</span></label>
                    <input type="range" min={1} max={5} value={form.priority} onChange={(e) => setForm({ ...form, priority: +e.target.value })} />
                  </div>
                </div>
              </div>

              {/* Details */}
              <div className="edit-section">
                <div className="edit-section-label">Details</div>
                <div className="edit-grid">
                  <div className="edit-field">
                    <label>Status</label>
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                      <option value="open">Open</option>
                      <option value="waiting">Waiting</option>
                      <option value="in_progress">In Progress</option>
                      <option value="goai">GoAi</option>
                      <option value="done">Done</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div className="edit-field">
                    <label>Estimate (min)</label>
                    <input type="number" min={1} max={480} value={form.estimate_min} onChange={(e) => setForm({ ...form, estimate_min: Math.max(1, Math.min(480, +e.target.value || 1)) })} />
                  </div>
                </div>
                <div className="edit-field" style={{ marginTop: 10 }}>
                  <label>Due date</label>
                  <DatePicker value={form.due_at} onChange={(v) => setForm({ ...form, due_at: v })} />
                </div>
                <div className="edit-field" style={{ marginTop: 10 }}>
                  <label>Tags</label>
                  <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Comma separated..." />
                </div>
                <div className="edit-field-inline" style={{ marginTop: 6 }}>
                  <label>
                    <input type="checkbox" checked={form.critical} onChange={(e) => setForm({ ...form, critical: e.target.checked })} />
                    Critical task
                  </label>
                </div>
              </div>

              {/* Triggers */}
              <div className="edit-section">
                <div className="edit-section-label">Triggers</div>

                {/* Triggered BY section */}
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    Triggered by
                    {triggersIn.length > 0 && (
                      <div className="view-toggle" style={{ marginLeft: "auto" }}>
                        <button className={form.trigger_mode === "or" ? "active" : ""} onClick={() => setForm({ ...form, trigger_mode: "or" })} style={{ padding: "2px 8px", fontSize: 11 }}>OR</button>
                        <button className={form.trigger_mode === "and" ? "active" : ""} onClick={() => setForm({ ...form, trigger_mode: "and" })} style={{ padding: "2px 8px", fontSize: 11 }}>AND</button>
                      </div>
                    )}
                  </label>
                  <div style={{ position: "relative", marginBottom: 6 }}>
                    <input
                      type="text"
                      value={triggerInSearch}
                      onChange={(e) => setTriggerInSearch(e.target.value)}
                      onFocus={() => setTriggerInFocused(true)}
                      onBlur={() => setTimeout(() => setTriggerInFocused(false), 200)}
                      placeholder="Search a task that triggers this one..."
                    />
                    {triggerInFocused && (
                      <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, maxHeight: 250, overflowY: "auto", zIndex: 50, boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }}>
                        {allTasks
                          .filter((t) => t.id !== taskId && !triggersIn.some((tr) => tr.source_task_id === t.id) && (!triggerInSearch || t.title.toLowerCase().includes(triggerInSearch.toLowerCase())))
                          .slice(0, 15)
                          .map((t) => {
                            const proj = t.project_id ? projectMap[t.project_id] : null;
                            return (
                              <div
                                key={t.id}
                                style={{ padding: "8px 10px", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 8, borderLeft: `3px solid ${proj?.color || "var(--border)"}`, background: "var(--bg-card)" }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)"; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-card)"; }}
                                onMouseDown={(e) => { e.preventDefault(); handleAddTriggerIn(t.id); }}
                              >
                                <span style={{ width: 10, height: 10, borderRadius: "50%", background: proj?.color || "var(--text-muted)", flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                                  {proj && <div style={{ color: proj.color, fontSize: 11, fontWeight: 500 }}>{proj.name}</div>}
                                </div>
                                <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{t.status}</span>
                              </div>
                            );
                          })}
                        {allTasks.filter((t) => t.id !== taskId && !triggersIn.some((tr) => tr.source_task_id === t.id) && (!triggerInSearch || t.title.toLowerCase().includes(triggerInSearch.toLowerCase()))).length === 0 && (
                          <div style={{ padding: "12px 10px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>No tasks found</div>
                        )}
                      </div>
                    )}
                  </div>
                  {triggersIn.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {triggersIn.map((tr, i) => {
                        const source = findTask(tr.source_task_id);
                        const proj = source?.project_id ? projectMap[source.project_id] : null;
                        const isDone = source?.status === "done";
                        return (
                          <div key={tr.id} className="trigger-picker-linked">
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: isDone ? "var(--green)" : proj?.color || "var(--text-muted)", flexShrink: 0 }} />
                            {i > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)" }}>{form.trigger_mode.toUpperCase()}</span>}
                            <span
                              className="trigger-link"
                              style={{ color: proj?.color || "var(--green)" }}
                              onClick={() => navigate(`/task/${tr.source_task_id}`)}
                            >
                              {source?.title || tr.source_task_id}
                            </span>
                            {isDone && <span style={{ fontSize: 10, color: "var(--green)", fontWeight: 600 }}>DONE</span>}
                            {proj && <span style={{ color: proj.color, fontSize: 11 }}>{proj.name}</span>}
                            <button
                              type="button"
                              className="secondary"
                              style={{ padding: "2px 8px", fontSize: 11, marginLeft: "auto" }}
                              onClick={() => handleRemoveTrigger(tr.id)}
                            >
                              &times;
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* GoAi toggle */}
                <div className="edit-field-inline">
                  <label>
                    <input type="checkbox" checked={form.trigger_goai} onChange={(e) => setForm({ ...form, trigger_goai: e.target.checked })} />
                    Send to GoAi when triggered
                  </label>
                </div>

                <div style={{ borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 10 }}>
                  {/* When THIS task is completed, trigger: */}
                  <div className="edit-field" style={{ marginBottom: 6 }}>
                    <label>When completed, trigger:</label>
                    <div style={{ position: "relative" }}>
                      <input
                        type="text"
                        value={triggerOutSearch}
                        onChange={(e) => setTriggerOutSearch(e.target.value)}
                        onFocus={() => setTriggerOutFocused(true)}
                        onBlur={() => setTimeout(() => setTriggerOutFocused(false), 200)}
                        placeholder="Search a task to trigger..."
                      />
                      {triggerOutFocused && (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, maxHeight: 250, overflowY: "auto", zIndex: 50, boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }}>
                          {allTasks
                            .filter((t) => t.id !== taskId && !triggersOut.some((tr) => tr.target_task_id === t.id) && (!triggerOutSearch || t.title.toLowerCase().includes(triggerOutSearch.toLowerCase())))
                            .slice(0, 15)
                            .map((t) => {
                              const proj = t.project_id ? projectMap[t.project_id] : null;
                              return (
                                <div
                                  key={t.id}
                                  style={{ padding: "8px 10px", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 8, borderLeft: `3px solid ${proj?.color || "var(--border)"}`, background: "var(--bg-card)" }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)"; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-card)"; }}
                                  onMouseDown={(e) => { e.preventDefault(); handleAddTriggerOut(t.id); }}
                                >
                                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: proj?.color || "var(--text-muted)", flexShrink: 0 }} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                                    {proj && <div style={{ color: proj.color, fontSize: 11, fontWeight: 500 }}>{proj.name}</div>}
                                  </div>
                                  <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{t.status}</span>
                                </div>
                              );
                            })}
                          {allTasks.filter((t) => t.id !== taskId && !triggersOut.some((tr) => tr.target_task_id === t.id) && (!triggerOutSearch || t.title.toLowerCase().includes(triggerOutSearch.toLowerCase()))).length === 0 && (
                            <div style={{ padding: "12px 10px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>No tasks found</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* List of tasks this triggers */}
                  {triggersOut.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {triggersOut.map((tr) => {
                        const target = findTask(tr.target_task_id);
                        const proj = target?.project_id ? projectMap[target.project_id] : null;
                        return (
                          <div key={tr.id} className="trigger-picker-linked">
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: proj?.color || "var(--accent)", flexShrink: 0 }} />
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                            <span
                              className="trigger-link"
                              style={{ color: proj?.color || "var(--accent)" }}
                              onClick={() => navigate(`/task/${tr.target_task_id}`)}
                            >
                              {target?.title || tr.target_task_id}
                            </span>
                            {proj && <span style={{ color: proj.color, fontSize: 11 }}>{proj.name}</span>}
                            <button
                              type="button"
                              className="secondary"
                              style={{ padding: "2px 8px", fontSize: 11, marginLeft: "auto" }}
                              onClick={() => handleRemoveTrigger(tr.id)}
                            >
                              &times;
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {error && <div style={{ color: "var(--red)", fontSize: 13, padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: 6 }}>{error}</div>}
            </div>
          )}

          {!editing && (
            <div className="task-detail-meta">
              <div className="meta-grid">
                <div className="meta-cell">
                  <span className="meta-label">Impact</span>
                  <span className="meta-value">{task.impact}<span className="meta-max">/5</span></span>
                </div>
                <div className="meta-cell">
                  <span className="meta-label">Effort</span>
                  <span className="meta-value">{task.effort}<span className="meta-max">/5</span></span>
                </div>
                <div className="meta-cell">
                  <span className="meta-label">Priority</span>
                  <span className="meta-value">{task.priority}<span className="meta-max">/5</span></span>
                </div>
                <div className="meta-cell">
                  <span className="meta-label">Score</span>
                  <span className="meta-value meta-accent">{task.score.toFixed(1)}</span>
                </div>
                <div className="meta-cell">
                  <span className="meta-label">Estimate</span>
                  <span className="meta-value">{task.estimate_min}<span className="meta-max">min</span></span>
                </div>
                <div className="meta-cell">
                  <span className="meta-label">Status</span>
                  <span className={`meta-status meta-status-${task.status}`}>{task.status.replace("_", " ")}</span>
                </div>
              </div>
              {task.critical && (
                <div className="meta-critical-badge">CRITICAL</div>
              )}
              {task.due_at && (
                <div className="meta-due-row">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  {new Date(task.due_at).toLocaleString()}
                </div>
              )}
              {task.tags.length > 0 && (
                <div className="task-tags" style={{ marginTop: 8 }}>
                  {task.tags.map((t) => <span key={t} className="tag">{t}</span>)}
                </div>
              )}
            </div>
          )}

          {/* Trigger links (read-only) */}
          {!editing && (triggersOut.length > 0 || triggersIn.length > 0) && (
            <div style={{ fontSize: 13, marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {triggersOut.length > 0 && (
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>When completed, triggers:</div>
                  {triggersOut.map((tr) => {
                    const target = findTask(tr.target_task_id);
                    const proj = target?.project_id ? projectMap[target.project_id] : null;
                    return (
                      <div key={tr.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                        <span style={{ color: proj?.color || "var(--accent)", cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate(`/task/${tr.target_task_id}`)}>
                          {target?.title || tr.target_task_id}
                        </span>
                        {target?.trigger_goai && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>GoAi</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              {triggersIn.length > 0 && (
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>
                    Triggered by ({task.trigger_mode.toUpperCase()}):
                    {task.trigger_goai && <span style={{ color: "var(--accent)", marginLeft: 6 }}>GoAi</span>}
                  </div>
                  {triggersIn.map((tr) => {
                    const source = findTask(tr.source_task_id);
                    const proj = source?.project_id ? projectMap[source.project_id] : null;
                    const isDone = source?.status === "done";
                    return (
                      <div key={tr.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: isDone ? "var(--green)" : "var(--text-muted)", flexShrink: 0 }} />
                        <span style={{ color: proj?.color || "var(--green)", cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate(`/task/${tr.source_task_id}`)}>
                          {source?.title || tr.source_task_id}
                        </span>
                        {isDone && <span style={{ fontSize: 10, color: "var(--green)", fontWeight: 600 }}>DONE</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Dependencies section */}
          <div className="edit-section" style={{ marginBottom: 12 }}>
            <div className="edit-section-label">Dependances</div>
            <div style={{ position: "relative", marginBottom: 6 }}>
              <input
                type="text"
                value={depSearch}
                onChange={(e) => setDepSearch(e.target.value)}
                onFocus={() => setDepFocused(true)}
                onBlur={() => setTimeout(() => setDepFocused(false), 200)}
                placeholder="Search a prerequisite task..."
              />
              {depFocused && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, maxHeight: 250, overflowY: "auto", zIndex: 50, boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }}>
                  {allTasks
                    .filter((t) => t.id !== taskId && !(task?.dependencies || []).some((d) => d.id === t.id) && (!depSearch || t.title.toLowerCase().includes(depSearch.toLowerCase())))
                    .slice(0, 15)
                    .map((t) => {
                      const proj = t.project_id ? projectMap[t.project_id] : null;
                      return (
                        <div
                          key={t.id}
                          style={{ padding: "8px 10px", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 8, borderLeft: `3px solid ${proj?.color || "var(--border)"}`, background: "var(--bg-card)" }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-card)"; }}
                          onMouseDown={(e) => { e.preventDefault(); handleAddDependency(t.id); }}
                        >
                          <span style={{ width: 10, height: 10, borderRadius: "50%", background: proj?.color || "var(--text-muted)", flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                            {proj && <div style={{ color: proj.color, fontSize: 11, fontWeight: 500 }}>{proj.name}</div>}
                          </div>
                          <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{t.status}</span>
                        </div>
                      );
                    })}
                  {allTasks.filter((t) => t.id !== taskId && !(task?.dependencies || []).some((d) => d.id === t.id) && (!depSearch || t.title.toLowerCase().includes(depSearch.toLowerCase()))).length === 0 && (
                    <div style={{ padding: "12px 10px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>No tasks found</div>
                  )}
                </div>
              )}
            </div>
            {(task?.dependencies || []).length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {(task?.dependencies || []).map((dep) => {
                  const proj = dep.project_id ? projectMap[dep.project_id] : null;
                  const isDone = dep.status === "done";
                  return (
                    <div key={dep.id} className="trigger-picker-linked">
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: isDone ? "var(--green)" : proj?.color || "var(--text-muted)", flexShrink: 0 }} />
                      <span
                        className="trigger-link"
                        style={{ color: proj?.color || "var(--accent)" }}
                        onClick={() => navigate(`/task/${dep.id}`)}
                      >
                        {dep.title}
                      </span>
                      {isDone && <span style={{ fontSize: 10, color: "var(--green)", fontWeight: 600 }}>DONE</span>}
                      {proj && <span style={{ color: proj.color, fontSize: 11 }}>{proj.name}</span>}
                      <button
                        type="button"
                        className="secondary"
                        style={{ padding: "2px 8px", fontSize: 11, marginLeft: "auto" }}
                        onClick={() => handleRemoveDependency(dep.id)}
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0" }}>No dependencies</div>
            )}
          </div>

          {/* Context / Notes section */}
          <div className="context-section">
            <div className="context-label">
              <span>Context</span>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <GenerateContextButton
                  tasks={[task]}
                  project={task.project_id ? projectMap[task.project_id] : null}
                  onDone={load}
                  iconSize={16}
                  className="secondary context-edit-btn"
                />
                <button
                  className="secondary context-edit-btn"
                  onClick={() => setEditingNotes(!editingNotes)}
                >
                  {editingNotes ? "Preview" : "Edit"}
                </button>
              </div>
            </div>
            {editingNotes ? (
              <textarea
                className="context-textarea"
                value={notes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Task notes, context, links... (Markdown supported)"
              />
            ) : (
              <div
                className="context-preview"
                onClick={() => setEditingNotes(true)}
              >
                {notes ? (
                  <MarkdownRenderer content={notes} />
                ) : (
                  <span className="context-placeholder">Click to add context...</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Subtasks */}
        <div className="split-right">
          <div className="split-right-header">
            <h3>Subtasks</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <AutoPlanButton
                task={task}
                project={task.project_id ? projectMap[task.project_id] : null}
                onDone={load}
                iconSize={14}
              />
              <GeneratePlanButton
                task={task}
                project={task.project_id ? projectMap[task.project_id] : null}
                onDone={load}
                iconSize={14}
              />
              <div className="view-toggle">
                <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                  List
                </button>
                <button className={view === "kanban" ? "active" : ""} onClick={() => setView("kanban")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg>
                  Kanban
                </button>
              </div>
            </div>
          </div>
          <TaskForm parentTaskId={task.id} projectId={task.project_id || undefined} onCreated={load} />
          {task.subtasks && task.subtasks.length > 0 ? (
            view === "kanban" ? (
              <KanbanBoard tasks={task.subtasks} onUpdate={load} />
            ) : (
              task.subtasks.map((st) => <TaskItem key={st.id} task={st} onUpdate={load} />)
            )
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "32px 16px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.4 }}>
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <line x1="9" y1="12" x2="15" y2="12" />
                <line x1="9" y1="16" x2="13" y2="16" />
              </svg>
              <span>No plan yet</span>
              <span style={{ fontSize: 12, opacity: 0.7 }}>Generate a plan with AutoPlan or Plan Preview above</span>
            </div>
          )}
        </div>
      </div>

      {goaiFlowTask && (
        <GoAiPlanFlow
          task={goaiFlowTask}
          onDone={() => { setGoaiFlowTask(null); load(); }}
        />
      )}

      {planFlowTask && (
        <PlanFirstFlow
          task={planFlowTask}
          onDone={() => { setPlanFlowTask(null); load(); }}
          onCancel={() => { setPlanFlowTask(null); }}
        />
      )}
    </div>
  );
}
