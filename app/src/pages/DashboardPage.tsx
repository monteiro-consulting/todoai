import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api } from "../api/client";
import { useProjectMap } from "../contexts/ProjectContext";
import type { Task } from "../types";

function ScrollTag({ text }: { text: string }) {
  const outerRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  const measure = useCallback(() => {
    if (!outerRef.current || !innerRef.current) return;
    const diff = innerRef.current.scrollWidth - outerRef.current.clientWidth;
    setOverflow(diff > 0 ? diff : 0);
  }, []);

  useEffect(() => { measure(); }, [text, measure]);

  return (
    <span
      className="dash-tag-label"
      ref={outerRef}
      style={{ "--scroll-dist": `-${overflow}px` } as React.CSSProperties}
    >
      <span
        ref={innerRef}
        className={overflow > 0 ? "dash-tag-text scrolling" : "dash-tag-text"}
      >
        {text}
      </span>
    </span>
  );
}

function flattenTasks(tasks: Task[]): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    out.push(t);
    if (t.subtasks?.length) out.push(...flattenTasks(t.subtasks));
  }
  return out;
}

export default function DashboardPage() {
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const projectMap = useProjectMap();

  useEffect(() => {
    (async () => {
      try {
        const [open, waiting, inProg, goai, done] = await Promise.all([
          api.listTasks({ status: "open" }),
          api.listTasks({ status: "waiting" }),
          api.listTasks({ status: "in_progress" }),
          api.listTasks({ status: "goai" }),
          api.listTasks({ status: "done" }),
        ]);
        setAllTasks([...open, ...waiting, ...inProg, ...goai, ...done]);
      } catch {
        setAllTasks([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const flat = useMemo(() => flattenTasks(allTasks), [allTasks]);

  const stats = useMemo(() => {
    const total = flat.length;
    const done = flat.filter((t) => t.status === "done").length;
    const open = flat.filter((t) => t.status === "open" || t.status === "waiting").length;
    const inProgress = flat.filter((t) => t.status === "in_progress" || t.status === "goai").length;
    const overdue = flat.filter((t) => {
      if (!t.due_at || t.status === "done") return false;
      return new Date(t.due_at) < new Date();
    }).length;
    const totalEstimate = flat.reduce((sum, t) => sum + (t.estimate_min || 0), 0);
    const doneEstimate = flat.filter((t) => t.status === "done").reduce((sum, t) => sum + (t.estimate_min || 0), 0);
    const openEstimate = flat.filter((t) => t.status !== "done").reduce((sum, t) => sum + (t.estimate_min || 0), 0);
    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, open, inProgress, overdue, totalEstimate, doneEstimate, openEstimate, completionRate };
  }, [flat]);

  // Completed per day (last 14 days) with project color segments
  const dailyCompletions = useMemo(() => {
    const days: { label: string; count: number; segments: { color: string; count: number }[] }[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("en", { weekday: "short", day: "numeric" });
      const dayTasks = flat.filter((t) => t.status === "done" && t.updated_at?.slice(0, 10) === key);
      // Group by project color
      const colorMap: Record<string, number> = {};
      for (const t of dayTasks) {
        const p = t.project_id ? projectMap[t.project_id] : null;
        const color = p?.color || "#555";
        colorMap[color] = (colorMap[color] || 0) + 1;
      }
      const segments = Object.entries(colorMap).map(([color, count]) => ({ color, count }));
      days.push({ label, count: dayTasks.length, segments });
    }
    return days;
  }, [flat, projectMap]);

  const maxDaily = Math.max(1, ...dailyCompletions.map((d) => d.count));

  // Per project stats
  const projectStats = useMemo(() => {
    const map: Record<string, { name: string; color: string; total: number; done: number; estimate: number }> = {};
    for (const t of flat) {
      const pid = t.project_id || "__inbox__";
      if (!map[pid]) {
        const p = t.project_id ? projectMap[t.project_id] : null;
        map[pid] = {
          name: p?.name || "Inbox",
          color: p?.color || "#555",
          total: 0,
          done: 0,
          estimate: 0,
        };
      }
      map[pid].total++;
      if (t.status === "done") map[pid].done++;
      map[pid].estimate += t.estimate_min || 0;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [flat, projectMap]);

  // Tag distribution with project color segments
  const tagStats = useMemo(() => {
    const map: Record<string, { total: number; colors: Record<string, number> }> = {};
    for (const t of flat) {
      const p = t.project_id ? projectMap[t.project_id] : null;
      const color = p?.color || "#555";
      for (const tag of t.tags) {
        if (!map[tag]) map[tag] = { total: 0, colors: {} };
        map[tag].total++;
        map[tag].colors[color] = (map[tag].colors[color] || 0) + 1;
      }
    }
    return Object.entries(map)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([tag, { total, colors }]) => ({
        tag,
        total,
        segments: Object.entries(colors).map(([color, count]) => ({ color, count })),
      }));
  }, [flat, projectMap]);

  const maxTag = Math.max(1, ...tagStats.map((t) => t.total));

  if (loading) return <div className="empty-state">Loading...</div>;

  const formatTime = (min: number) => {
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  return (
    <div>
      <div className="header-row"><h2>Dashboard</h2></div>

      {/* Stat cards */}
      <div className="dash-cards">
        <div className="dash-card">
          <div className="dash-card-value">{stats.total}</div>
          <div className="dash-card-label">Total Tasks</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-value" style={{ color: "var(--green)" }}>{stats.done}</div>
          <div className="dash-card-label">Completed</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-value" style={{ color: "#3b82f6" }}>{stats.inProgress}</div>
          <div className="dash-card-label">In Progress</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-value">{stats.open}</div>
          <div className="dash-card-label">To Do</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-value" style={{ color: "var(--red)" }}>{stats.overdue}</div>
          <div className="dash-card-label">Overdue</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-value">{stats.completionRate}%</div>
          <div className="dash-card-label">Completion Rate</div>
          <div className="dash-progress">
            <div className="dash-progress-bar" style={{ width: `${stats.completionRate}%` }} />
          </div>
        </div>
      </div>

      {/* Time estimates */}
      <div className="dash-section">
        <h3>Time Estimates</h3>
        <div className="dash-time-row">
          <div className="dash-time-block">
            <div className="dash-time-value">{formatTime(stats.doneEstimate)}</div>
            <div className="dash-time-label">Completed</div>
          </div>
          <div className="dash-time-block">
            <div className="dash-time-value">{formatTime(stats.openEstimate)}</div>
            <div className="dash-time-label">Remaining</div>
          </div>
          <div className="dash-time-block">
            <div className="dash-time-value">{formatTime(stats.totalEstimate)}</div>
            <div className="dash-time-label">Total</div>
          </div>
        </div>
        <div className="dash-progress" style={{ height: 8, marginTop: 8 }}>
          <div
            className="dash-progress-bar"
            style={{ width: stats.totalEstimate > 0 ? `${(stats.doneEstimate / stats.totalEstimate) * 100}%` : "0%" }}
          />
        </div>
      </div>

      {/* Daily completions chart */}
      <div className="dash-section">
        <h3>Completed (Last 14 Days)</h3>
        <div className="dash-chart">
          {dailyCompletions.map((d, i) => (
            <div key={i} className="dash-bar-col">
              <div className="dash-bar-value">{d.count > 0 ? d.count : ""}</div>
              <div className="dash-bar-stack" style={{ height: `${(d.count / maxDaily) * 100}%` }}>
                {d.segments.map((seg, j) => (
                  <div
                    key={j}
                    className="dash-bar-segment"
                    style={{
                      flex: seg.count,
                      backgroundColor: seg.color,
                    }}
                    title={`${seg.count} task${seg.count > 1 ? "s" : ""}`}
                  />
                ))}
              </div>
              <div className="dash-bar-label">{d.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="dash-grid">
        {/* Per project */}
        <div className="dash-section">
          <h3>By Project</h3>
          {projectStats.map((p) => (
            <div key={p.name} className="dash-project-row">
              <span className="dash-project-dot" style={{ backgroundColor: p.color }} />
              <span className="dash-project-name">{p.name}</span>
              <span className="dash-project-nums">{p.done}/{p.total}</span>
              <div className="dash-mini-progress">
                <div
                  className="dash-mini-progress-bar"
                  style={{ width: p.total > 0 ? `${(p.done / p.total) * 100}%` : "0%", backgroundColor: p.color }}
                />
              </div>
              <span className="dash-project-time">{formatTime(p.estimate)}</span>
            </div>
          ))}
        </div>

        {/* Tags */}
        <div className="dash-section">
          <h3>Top Tags</h3>
          {tagStats.map((t) => (
            <div key={t.tag} className="dash-tag-row">
              <ScrollTag text={t.tag} />
              <div className="dash-tag-track">
                <div className="dash-tag-bar-wrapper" style={{ width: `${(t.total / maxTag) * 100}%` }}>
                  {t.segments.map((seg, i) => (
                    <div
                      key={i}
                      className="dash-tag-segment"
                      style={{ flex: seg.count, backgroundColor: seg.color }}
                    />
                  ))}
                </div>
              </div>
              <span className="dash-tag-count">{t.total}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
