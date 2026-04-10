import { useState } from "react";
import type { SubtaskProposal } from "../api/client";

interface Props {
  proposals: SubtaskProposal[];
  parentTitle: string;
  onConfirm: (subtasks: SubtaskProposal[]) => void;
  onCancel: () => void;
  confirming: boolean;
}

export default function PlanPreview({ proposals, parentTitle, onConfirm, onCancel, confirming }: Props) {
  const [subtasks, setSubtasks] = useState<SubtaskProposal[]>(proposals);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const totalEstimate = subtasks.reduce((sum, s) => sum + s.estimate_min, 0);

  const handleRemove = (idx: number) => {
    setSubtasks((prev) => prev.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
    else if (editingIdx !== null && editingIdx > idx) setEditingIdx(editingIdx - 1);
  };

  const handleUpdate = (idx: number, field: keyof SubtaskProposal, value: any) => {
    setSubtasks((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const handleMoveUp = (idx: number) => {
    if (idx === 0) return;
    setSubtasks((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
    if (editingIdx === idx) setEditingIdx(idx - 1);
    else if (editingIdx === idx - 1) setEditingIdx(idx);
  };

  const handleMoveDown = (idx: number) => {
    if (idx >= subtasks.length - 1) return;
    setSubtasks((prev) => {
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
    if (editingIdx === idx) setEditingIdx(idx + 1);
    else if (editingIdx === idx + 1) setEditingIdx(idx);
  };

  return (
    <div className="plan-preview-overlay" onClick={onCancel}>
      <div className="plan-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="plan-preview-header">
          <div>
            <h3>Plan Preview</h3>
            <div className="plan-preview-parent">
              {parentTitle}
            </div>
          </div>
          <div className="plan-preview-summary">
            {subtasks.length} subtask{subtasks.length !== 1 ? "s" : ""} &middot; ~{totalEstimate}min
          </div>
        </div>

        <div className="plan-preview-list">
          {subtasks.map((st, idx) => (
            <div key={idx} className={`plan-preview-item ${editingIdx === idx ? "editing" : ""}`}>
              <div className="plan-preview-item-header">
                <div className="plan-preview-item-order">
                  <button
                    className="plan-preview-move"
                    disabled={idx === 0}
                    onClick={() => handleMoveUp(idx)}
                    title="Move up"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
                  </button>
                  <span className="plan-preview-num">{idx + 1}</span>
                  <button
                    className="plan-preview-move"
                    disabled={idx === subtasks.length - 1}
                    onClick={() => handleMoveDown(idx)}
                    title="Move down"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                </div>

                <div className="plan-preview-item-content" onClick={() => setEditingIdx(editingIdx === idx ? null : idx)}>
                  {editingIdx === idx ? (
                    <input
                      value={st.title}
                      onChange={(e) => handleUpdate(idx, "title", e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span className="plan-preview-title">{st.title}</span>
                  )}
                  <div className="plan-preview-meta">
                    <span title="Impact">I:{st.impact}</span>
                    <span title="Effort">E:{st.effort}</span>
                    <span title="Estimate">{st.estimate_min}min</span>
                    {st.tags.length > 0 && st.tags.map((t) => <span key={t} className="tag">{t}</span>)}
                  </div>
                </div>

                <button
                  className="plan-preview-remove"
                  onClick={() => handleRemove(idx)}
                  title="Remove subtask"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>

              {editingIdx === idx && (
                <div className="plan-preview-item-edit">
                  <textarea
                    value={st.notes || ""}
                    onChange={(e) => handleUpdate(idx, "notes", e.target.value || null)}
                    placeholder="Description..."
                    rows={2}
                  />
                  <div className="plan-preview-edit-row">
                    <div className="plan-preview-edit-field">
                      <label>Impact</label>
                      <input type="number" min={1} max={5} value={st.impact} onChange={(e) => handleUpdate(idx, "impact", Math.max(1, Math.min(5, +e.target.value)))} />
                    </div>
                    <div className="plan-preview-edit-field">
                      <label>Effort</label>
                      <input type="number" min={1} max={5} value={st.effort} onChange={(e) => handleUpdate(idx, "effort", Math.max(1, Math.min(5, +e.target.value)))} />
                    </div>
                    <div className="plan-preview-edit-field">
                      <label>Estimate (min)</label>
                      <input type="number" min={5} max={480} value={st.estimate_min} onChange={(e) => handleUpdate(idx, "estimate_min", Math.max(5, Math.min(480, +e.target.value)))} />
                    </div>
                    <div className="plan-preview-edit-field" style={{ flex: 2 }}>
                      <label>Tags</label>
                      <input
                        value={st.tags.join(", ")}
                        onChange={(e) => handleUpdate(idx, "tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))}
                        placeholder="tag1, tag2..."
                      />
                    </div>
                  </div>
                </div>
              )}

              {editingIdx !== idx && st.notes && (
                <div className="plan-preview-notes">{st.notes}</div>
              )}
            </div>
          ))}

          {subtasks.length === 0 && (
            <div className="plan-preview-empty">
              All subtasks have been removed. Cancel to go back.
            </div>
          )}
        </div>

        <div className="plan-preview-footer">
          <button className="secondary" onClick={onCancel} disabled={confirming}>
            Cancel
          </button>
          <button
            onClick={() => onConfirm(subtasks)}
            disabled={subtasks.length === 0 || confirming}
          >
            {confirming ? "Creating..." : `Confirm ${subtasks.length} subtask${subtasks.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
