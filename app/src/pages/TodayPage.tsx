import { useState } from "react";
import { api } from "../api/client";
import type { PlanResult } from "../types";

export default function TodayPage() {
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [minutes, setMinutes] = useState(480);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const result = await api.planToday({ available_minutes: minutes });
      setPlan(result);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div>
      <div className="header-row">
        <h2>Today's Plan</h2>
      </div>
      <div className="form-row" style={{ marginBottom: 20 }}>
        <div>
          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Available minutes</label>
          <input type="number" min={30} max={960} value={minutes} onChange={(e) => setMinutes(+e.target.value)} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button onClick={generate} disabled={loading}>
            {loading ? "Planning..." : "Generate Plan"}
          </button>
        </div>
      </div>

      {plan && (
        <div>
          <div style={{ marginBottom: 16, fontSize: 13, color: "var(--text-muted)" }}>
            Planned: {plan.total_minutes}min | Remaining: {plan.remaining_minutes}min
          </div>
          {plan.tasks.length === 0 ? (
            <div className="empty-state">No tasks to plan</div>
          ) : (
            plan.tasks.map((t) => (
              <div key={t.task_id} className="plan-slot">
                <span className="plan-time">{formatTime(t.start_at)} - {formatTime(t.end_at)}</span>
                <span className="task-title">{t.title}</span>
                <span className="score-badge score-high">{t.score.toFixed(1)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {!plan && !loading && (
        <div className="empty-state">Click "Generate Plan" to get your optimized daily plan</div>
      )}
    </div>
  );
}
