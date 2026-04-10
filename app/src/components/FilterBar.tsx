import { useState, useEffect } from "react";
import type { TaskFilters, SortMode } from "../types";

function DualRange({ min, max, value, onChange }: { min: number; max: number; value: [number, number]; onChange: (v: [number, number]) => void }) {
  // Each thumb tracks its own independent position — they can freely cross
  const [a, setA] = useState(value[0]);
  const [b, setB] = useState(value[1]);

  // Sync from parent only when sorted values actually differ
  useEffect(() => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (value[0] !== lo || value[1] !== hi) {
      setA(value[0]);
      setB(value[1]);
    }
  }, [value[0], value[1]]);

  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  const handleA = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setA(v);
    onChange([Math.min(v, b), Math.max(v, b)]);
  };

  const handleB = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setB(v);
    onChange([Math.min(a, v), Math.max(a, v)]);
  };

  return (
    <div className="dual-range">
      <div className="dual-range-track" />
      <div
        className="dual-range-fill"
        style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }}
      />
      <input type="range" min={min} max={max} value={a} onChange={handleA} className={`dual-range-input${a >= b ? " on-top" : ""}`} />
      <input type="range" min={min} max={max} value={b} onChange={handleB} className={`dual-range-input${b >= a ? " on-top" : ""}`} />
    </div>
  );
}

import type { Task } from "../types";

interface Props {
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  availableTags: string[];
  tasks: Task[];
}

const sortOptions: { value: SortMode; label: string }[] = [
  { value: "score", label: "Score" },
  { value: "due", label: "Due" },
  { value: "created", label: "Created" },
  { value: "manual", label: "Manual" },
];

const statusOptions = ["open", "waiting", "late", "in_progress", "goai", "done", "all"] as const;
const statusLabels: Record<string, string> = { open: "Open", waiting: "Waiting", in_progress: "In Progress", goai: "GoAi", done: "Done", late: "Late", all: "All" };
const statusColors: Record<string, string> = { open: "#888", waiting: "#a855f7", in_progress: "#eab308", goai: "#eab308", done: "#22c55e", late: "#ef4444", all: "#3b82f6" };

export default function FilterBar({ filters, onFiltersChange, sortMode, onSortChange, availableTags, tasks }: Props) {
  const update = (patch: Partial<TaskFilters>) => {
    onFiltersChange({ ...filters, ...patch });
  };

  // Count tasks per status
  const now = new Date();
  const statusCounts: Record<string, number> = { open: 0, waiting: 0, in_progress: 0, goai: 0, done: 0, late: 0, all: tasks.length };
  for (const t of tasks) {
    if (t.status === "open" || t.status === "waiting" || t.status === "in_progress" || t.status === "goai") statusCounts[t.status]++;
    if (t.status === "done") statusCounts.done++;
    if (t.status !== "done" && t.due_at && new Date(t.due_at) < now) statusCounts.late++;
  }

  const visibleStatuses = statusOptions.filter((s) => s === "all" || s === filters.status || statusCounts[s] > 0);

  const toggleTag = (tag: string) => {
    const next = filters.tags.includes(tag)
      ? filters.tags.filter((t) => t !== tag)
      : [...filters.tags, tag];
    update({ tags: next });
  };

  const currentSort = sortOptions.find((o) => o.value === sortMode)!;

  return (
    <div className="filter-bar">
      {/* Status expand */}
      <div className="fb-expand">
        <span className="fb-label">Status</span>
        {visibleStatuses.map((s) => (
          <button
            key={s}
            className={`fb-opt ${filters.status === s ? "fb-opt-active" : "fb-opt-rest"}`}
            style={{ color: statusColors[s], borderColor: statusColors[s] + "44" }}
            onClick={() => update({ status: s })}
          >
            {statusLabels[s]}
          </button>
        ))}
      </div>

      {/* Sort expand */}
      <div className="fb-expand">
        <span className="fb-label">Sort</span>
        {sortOptions.map((opt) => (
          <button
            key={opt.value}
            className={`fb-opt ${sortMode === opt.value ? "fb-opt-active" : "fb-opt-rest"}`}
            onClick={() => onSortChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Impact range */}
      <div className="fb-item">
        <span className="fb-label">Impact</span>
        <span className="fb-value">{filters.impactRange[0]}-{filters.impactRange[1]}</span>
        <DualRange min={1} max={5} value={filters.impactRange} onChange={(v) => update({ impactRange: v })} />
      </div>

      {/* Effort range */}
      <div className="fb-item">
        <span className="fb-label">Effort</span>
        <span className="fb-value">{filters.effortRange[0]}-{filters.effortRange[1]}</span>
        <DualRange min={1} max={5} value={filters.effortRange} onChange={(v) => update({ effortRange: v })} />
      </div>

      {/* Tags */}
      {availableTags.length > 0 && (
        <div className="fb-tags">
          {availableTags.map((tag) => (
            <button
              key={tag}
              className={`fb-tag ${filters.tags.includes(tag) ? "fb-tag-on" : ""}`}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
