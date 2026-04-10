import { useState, useRef, useEffect } from "react";
import { api } from "../api/client";

interface Props {
  projectId?: string;
  parentTaskId?: string;
  onCreated: () => void;
  onDump?: () => void;
}

export default function TaskForm({ projectId, parentTaskId, onCreated, onDump }: Props) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input via global shortcut (Ctrl+N)
  useEffect(() => {
    const handler = () => inputRef.current?.focus();
    window.addEventListener("todoai:focus-new-task", handler);
    return () => window.removeEventListener("todoai:focus-new-task", handler);
  }, []);
  const [showDetails, setShowDetails] = useState(false);
  const [impact, setImpact] = useState(3);
  const [effort, setEffort] = useState(3);
  const [estimate, setEstimate] = useState(30);
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!title.trim()) return;
    setError("");
    try {
      await api.createTask({
        title: title.trim(),
        project_id: projectId || null,
        parent_task_id: parentTaskId || null,
        impact,
        effort,
        estimate_min: estimate,
        tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        notes: notes.trim() || null,
      });
      setTitle("");
      setTags("");
      setNotes("");
      setShowDetails(false);
      onCreated();
    } catch (err: any) {
      setError(err.message || "Failed to create task");
      console.error("Task creation error:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="+ Add a task... (Ctrl+N)"
          style={{ flex: 1 }}
        />
        <button onClick={() => handleSubmit()} disabled={!title.trim()}>Add</button>
        {onDump && (
          <button
            className="secondary"
            onClick={onDump}
            style={{ fontSize: 12, padding: "6px 10px" }}
            title="Dump: create multiple tasks at once"
          >
            Dump
          </button>
        )}
        <button
          className="secondary"
          onClick={() => setShowDetails(!showDetails)}
          style={{ fontSize: 12, padding: "6px 10px" }}
        >
          {showDetails ? "▲" : "▼"}
        </button>
      </div>
      {error && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 4 }}>{error}</div>}
      {showDetails && (
        <div style={{ marginTop: 8, padding: 12, background: "var(--bg-card)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
          <div className="form-row">
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Impact (1-5)</label>
              <input type="number" min={1} max={5} value={impact} onChange={(e) => setImpact(+e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Effort (1-5)</label>
              <input type="number" min={1} max={5} value={effort} onChange={(e) => setEffort(+e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Estimate (min)</label>
              <input type="number" min={1} max={480} value={estimate} onChange={(e) => setEstimate(+e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags (comma separated)" />
          </div>
          <div className="form-row">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context, notes, links... (Markdown supported)"
              rows={3}
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
