import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useProjectMap } from "../contexts/ProjectContext";
import type { Task } from "../types";

interface Reminder {
  task: Task;
  urgency: "overdue" | "today" | "tomorrow" | "soon";
  label: string;
}

function classifyTask(task: Task): Reminder | null {
  if (!task.due_at || task.status === "done") return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(task.due_at);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diff = Math.round((dueDay.getTime() - today.getTime()) / 86400000);

  if (diff < 0) return { task, urgency: "overdue", label: `${Math.abs(diff)}d overdue` };
  if (diff === 0) return { task, urgency: "today", label: "Due today" };
  if (diff === 1) return { task, urgency: "tomorrow", label: "Due tomorrow" };
  if (diff <= 3) return { task, urgency: "soon", label: `Due in ${diff}d` };
  return null;
}

function flattenTasks(tasks: Task[]): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    out.push(t);
    if (t.subtasks?.length) out.push(...flattenTasks(t.subtasks));
  }
  return out;
}

export default function NotificationBell() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const projectMap = useProjectMap();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const notifiedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const tasks = await api.listTasks({ status: "open" });
      const flat = flattenTasks(tasks);
      const r: Reminder[] = [];
      for (const t of flat) {
        const c = classifyTask(t);
        if (c) r.push(c);
      }
      // Sort: overdue first, then today, tomorrow, soon
      const order = { overdue: 0, today: 1, tomorrow: 2, soon: 3 };
      r.sort((a, b) => order[a.urgency] - order[b.urgency]);
      setReminders(r);

      // System notification on first load if there are overdue/today tasks
      if (!notifiedRef.current && r.length > 0) {
        notifiedRef.current = true;
        const urgent = r.filter((x) => x.urgency === "overdue" || x.urgency === "today");
        if (urgent.length > 0 && "Notification" in window) {
          if (Notification.permission === "default") {
            await Notification.requestPermission();
          }
          if (Notification.permission === "granted") {
            const count = urgent.length;
            new Notification("TodoAI", {
              body: `${count} task${count > 1 ? "s" : ""} due today or overdue`,
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, [refresh]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const count = reminders.length;
  const hasUrgent = reminders.some((r) => r.urgency === "overdue" || r.urgency === "today");

  return (
    <div className="notif-wrapper" ref={wrapperRef}>
      <button
        className={`titlebar-btn notif-bell ${hasUrgent ? "has-urgent" : ""}`}
        onClick={() => setOpen(!open)}
        title={`${count} reminder${count !== 1 ? "s" : ""}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && <span className="notif-badge">{count}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-header">Reminders</div>
          {reminders.length === 0 ? (
            <div className="notif-empty">No upcoming deadlines</div>
          ) : (
            reminders.map((r) => {
              const project = r.task.project_id ? projectMap[r.task.project_id] : null;
              return (
                <div
                  key={r.task.id}
                  className={`notif-item notif-${r.urgency}`}
                  onClick={() => { setOpen(false); navigate(`/task/${r.task.id}`); }}
                >
                  {project && (
                    <span className="notif-dot" style={{ backgroundColor: project.color }} />
                  )}
                  <span className="notif-title">{r.task.title}</span>
                  <span className={`notif-label notif-label-${r.urgency}`}>{r.label}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
