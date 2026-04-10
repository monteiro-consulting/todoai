import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useProjectMap } from "../contexts/ProjectContext";
import type { Task } from "../types";

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Task[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const navigate = useNavigate();
  const projectMap = useProjectMap();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch all tasks and filter client-side (simple approach)
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const allTasks = await api.listTasks();
        const q = query.toLowerCase();
        const flat = flattenTasks(allTasks);
        const matched = flat.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
            (t.notes && t.notes.toLowerCase().includes(q))
        );
        setResults(matched.slice(0, 10));
        setOpen(true);
        setSelected(0);
      } catch {
        setResults([]);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

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

  // Focus search via global shortcut event (Ctrl+K)
  useEffect(() => {
    const handler = () => inputRef.current?.focus();
    window.addEventListener("todoai:focus-search", handler);
    return () => window.removeEventListener("todoai:focus-search", handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      goToTask(results[selected]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const goToTask = (task: Task) => {
    setQuery("");
    setOpen(false);
    navigate(`/task/${task.id}`);
  };

  return (
    <div className="search-bar-wrapper" ref={wrapperRef}>
      <div className="search-bar">
        <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search tasks... (Ctrl+K)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length) setOpen(true); }}
        />
        {query && (
          <button className="search-clear" onClick={() => { setQuery(""); setOpen(false); }}>
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5">
              <line x1="0" y1="0" x2="10" y2="10" /><line x1="10" y1="0" x2="0" y2="10" />
            </svg>
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="search-results">
          {results.map((task, i) => {
            const project = task.project_id ? projectMap[task.project_id] : null;
            return (
              <div
                key={task.id}
                className={`search-result-item ${i === selected ? "selected" : ""}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => goToTask(task)}
              >
                {project && (
                  <span className="search-result-dot" style={{ backgroundColor: project.color }} />
                )}
                <span className="search-result-title">{task.title}</span>
                {task.status === "done" && <span className="search-result-done">done</span>}
                <div className="search-result-tags">
                  {task.tags.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open && query.trim() && results.length === 0 && (
        <div className="search-results">
          <div className="search-no-results">No tasks found</div>
        </div>
      )}
    </div>
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
