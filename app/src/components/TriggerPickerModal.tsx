import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api/client";
import { useProjectMap } from "../contexts/ProjectContext";
import type { Task } from "../types";

interface Props {
  task: Task;
  onConfirm: (sourceTaskIds: string[]) => void;
  onCancel: () => void;
}

export default function TriggerPickerModal({ task, onConfirm, onCancel }: Props) {
  const projectMap = useProjectMap();
  const [search, setSearch] = useState("");
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (creating) {
          setCreating(false);
          setNewTitle("");
        } else {
          onCancel();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, creating]);

  // Load candidate tasks (open, in_progress, goai — not done/archived/waiting)
  useEffect(() => {
    (async () => {
      const [open, ip, goai] = await Promise.all([
        api.listTasks({ status: "open" }),
        api.listTasks({ status: "in_progress" }),
        api.listTasks({ status: "goai" }),
      ]);
      // Flatten subtasks
      const flatten = (tasks: Task[]): Task[] => {
        const out: Task[] = [];
        for (const t of tasks) {
          out.push(t);
          if (t.subtasks?.length) out.push(...flatten(t.subtasks));
        }
        return out;
      };
      const all = flatten([...open, ...ip, ...goai]).filter((t) => t.id !== task.id);
      setAllTasks(all);
      setLoading(false);
    })();
  }, [task.id]);

  const filtered = allTasks.filter(
    (t) =>
      !selected.includes(t.id) &&
      (!search || t.title.toLowerCase().includes(search.toLowerCase()))
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setSearch("");
  }, []);

  const handleConfirm = () => {
    onConfirm(selected);
  };

  const handleCreateTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(false);
    try {
      const created = await api.createTask({
        title,
        project_id: task.project_id || null,
      });
      setAllTasks((prev) => [...prev, created]);
      setSelected((prev) => [...prev, created.id]);
      setNewTitle("");
    } catch (err) {
      console.error("Failed to create trigger task:", err);
    }
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateTask();
    }
  };

  // Focus create input when switching to create mode
  useEffect(() => {
    if (creating) createInputRef.current?.focus();
  }, [creating]);

  const noCandidates = !loading && allTasks.length === 0 && selected.length === 0;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-modal trigger-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-title">Waiting for which task?</div>
        <div className="confirm-message">
          {noCandidates ? (
            <>
              No tasks available to trigger <strong>{task.title}</strong>.
              Create a new task or cancel to keep the current status.
            </>
          ) : (
            <>
              <strong>{task.title}</strong> will be set to <em>waiting</em>. Select the task(s) that should trigger it when completed.
            </>
          )}
        </div>

        {/* Selected tasks */}
        {selected.length > 0 && (
          <div className="trigger-modal-selected">
            {selected.map((id) => {
              const t = allTasks.find((x) => x.id === id);
              if (!t) return null;
              const proj = t.project_id ? projectMap[t.project_id] : null;
              return (
                <div key={id} className="trigger-modal-chip">
                  {proj && (
                    <span
                      className="kanban-card-dot"
                      style={{ backgroundColor: proj.color }}
                    />
                  )}
                  <span className="trigger-modal-chip-title">{t.title}</span>
                  <button
                    className="trigger-modal-chip-remove"
                    onClick={() => toggleSelect(id)}
                  >
                    x
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Inline task creation */}
        {creating ? (
          <div className="trigger-modal-create-row">
            <input
              ref={createInputRef}
              className="trigger-modal-search"
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={handleCreateKeyDown}
              placeholder="New task title..."
              style={{ marginBottom: 0 }}
            />
            <button
              className="trigger-modal-create-confirm"
              disabled={!newTitle.trim()}
              onClick={handleCreateTask}
            >
              Add
            </button>
            <button
              className="secondary trigger-modal-create-cancel"
              onClick={() => { setCreating(false); setNewTitle(""); }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="trigger-modal-create-btn"
            onClick={() => setCreating(true)}
          >
            + Create a new task
          </button>
        )}

        {/* Search input */}
        {!noCandidates && (
          <input
            ref={inputRef}
            className="trigger-modal-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a task..."
          />
        )}

        {/* Results list */}
        {!noCandidates && (
          <div className="trigger-modal-results">
            {filtered.slice(0, 12).map((t) => {
              const proj = t.project_id ? projectMap[t.project_id] : null;
              return (
                <div
                  key={t.id}
                  className="trigger-modal-result"
                  onClick={() => toggleSelect(t.id)}
                >
                  {proj && (
                    <span
                      className="kanban-card-dot"
                      style={{ backgroundColor: proj.color }}
                    />
                  )}
                  <span>{t.title}</span>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="trigger-modal-empty">No tasks found</div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="confirm-actions">
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            disabled={selected.length === 0}
            onClick={handleConfirm}
          >
            Set Waiting ({selected.length})
          </button>
        </div>
      </div>
    </div>
  );
}
