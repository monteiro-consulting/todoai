import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import { api, type TaskSuggestion } from "../api/client";
import { useProjectMap } from "../contexts/ProjectContext";

interface Props {
  projectId?: string;
  onCreated: () => void;
}

export interface SuggestionsPanelHandle {
  generate: () => void;
}

const SuggestionsPanel = forwardRef<SuggestionsPanelHandle, Props>(({ projectId, onCreated }, ref) => {
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<Set<number>>(new Set());
  const projectMap = useProjectMap();

  const handleGenerate = async () => {
    setLoading(true);
    setError("");
    setSuggestions([]);
    setOpen(true);
    try {
      const data = await api.suggestTasks(projectId ? { project_id: projectId } : {});
      setSuggestions(data.suggestions);
    } catch (err: any) {
      setError(err.message || "Failed to generate suggestions");
    } finally {
      setLoading(false);
    }
  };

  useImperativeHandle(ref, () => ({ generate: handleGenerate }));

  const handleAccept = async (index: number, suggestion: TaskSuggestion) => {
    setCreating((prev) => new Set(prev).add(index));
    try {
      await api.createTask({
        title: suggestion.title,
        project_id: suggestion.project_id || projectId || null,
        impact: suggestion.impact,
        effort: suggestion.effort,
        estimate_min: suggestion.estimate_min,
        tags: suggestion.tags,
      });
      setSuggestions((prev) => prev.filter((_, i) => i !== index));
      onCreated();
    } catch (err: any) {
      setError(err.message || "Failed to create task");
    } finally {
      setCreating((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  const handleDismiss = (index: number) => {
    setSuggestions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAcceptAll = async () => {
    for (let i = suggestions.length - 1; i >= 0; i--) {
      await handleAccept(i, suggestions[i]);
    }
  };

  if (!open) return null;

  return (
    <div className="suggestions-panel">
      <div className="suggestions-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--yellow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z" />
          </svg>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            AI Suggestions
            {suggestions.length > 0 && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> ({suggestions.length})</span>}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {suggestions.length > 0 && (
            <button
              className="secondary"
              onClick={handleAcceptAll}
              style={{ fontSize: 11, padding: "3px 8px" }}
            >
              Accept all
            </button>
          )}
          <button
            className="secondary"
            onClick={handleGenerate}
            disabled={loading}
            style={{ fontSize: 11, padding: "3px 8px" }}
          >
            {loading ? "..." : "Refresh"}
          </button>
          <button
            className="secondary"
            onClick={() => { setOpen(false); setSuggestions([]); }}
            style={{ fontSize: 11, padding: "3px 8px" }}
          >
            Close
          </button>
        </div>
      </div>

      {error && <div style={{ color: "var(--red)", fontSize: 12, padding: "8px 12px" }}>{error}</div>}

      {loading && (
        <div className="suggestions-loading">
          <div className="suggestion-spinner" />
          Analyzing your tasks...
        </div>
      )}

      {!loading && suggestions.length === 0 && !error && (
        <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
          No suggestions generated. Try refreshing.
        </div>
      )}

      <div className="suggestions-list">
        {suggestions.map((s, i) => {
          const projectName = s.project_id ? projectMap[s.project_id]?.name : null;
          return (
            <div key={`${s.title}-${i}`} className="suggestion-item">
              <div className="suggestion-content">
                <div className="suggestion-title">{s.title}</div>
                <div className="suggestion-reason">{s.reason}</div>
                <div className="suggestion-meta">
                  {projectName && (
                    <span className="suggestion-project">{projectName}</span>
                  )}
                  <span title="Impact">I:{s.impact}</span>
                  <span title="Effort">E:{s.effort}</span>
                  <span title="Estimate">{s.estimate_min}min</span>
                  {s.tags.length > 0 && s.tags.map((tag) => (
                    <span key={tag} className="suggestion-tag">{tag}</span>
                  ))}
                </div>
              </div>
              <div className="suggestion-actions">
                <button
                  onClick={() => handleAccept(i, s)}
                  disabled={creating.has(i)}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                  title="Create this task"
                >
                  {creating.has(i) ? "..." : "+"}
                </button>
                <button
                  className="secondary"
                  onClick={() => handleDismiss(i)}
                  style={{ fontSize: 11, padding: "4px 8px" }}
                  title="Dismiss"
                >
                  x
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default SuggestionsPanel;
