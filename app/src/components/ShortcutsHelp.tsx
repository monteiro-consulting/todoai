import { useState, useEffect } from "react";
import type { ShortcutDef } from "../hooks/useGlobalShortcuts";

interface Props {
  shortcuts: ShortcutDef[];
}

export default function ShortcutsHelp({ shortcuts }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen((v) => !v);
    window.addEventListener("todoai:toggle-shortcuts", handler);
    return () => window.removeEventListener("todoai:toggle-shortcuts", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  // Group by category
  const grouped: Record<string, ShortcutDef[]> = {};
  for (const s of shortcuts) {
    if (!grouped[s.category]) grouped[s.category] = [];
    grouped[s.category].push(s);
  }

  const formatKey = (s: ShortcutDef) => {
    const parts: string[] = [];
    if (s.ctrl) parts.push("Ctrl");
    if (s.shift) parts.push("Shift");
    if (s.alt) parts.push("Alt");
    parts.push(s.key === "/" ? "/" : s.key.toUpperCase());
    return parts;
  };

  return (
    <>
      <div className="shortcuts-backdrop" onClick={() => setOpen(false)} />
      <div className="shortcuts-modal">
        <div className="shortcuts-header">
          <h2>Keyboard shortcuts</h2>
          <button className="shortcuts-close" onClick={() => setOpen(false)}>
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="2">
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>
        <div className="shortcuts-body">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat} className="shortcuts-group">
              <h3>{cat}</h3>
              {items.map((s) => (
                <div key={s.key + (s.ctrl ? "c" : "") + (s.shift ? "s" : "")} className="shortcut-row">
                  <span className="shortcut-label">{s.label}</span>
                  <span className="shortcut-keys">
                    {formatKey(s).map((k, i) => (
                      <span key={i}>
                        <kbd>{k}</kbd>
                        {i < formatKey(s).length - 1 && <span className="shortcut-plus">+</span>}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="shortcuts-footer">
          Press <kbd>Esc</kbd> or <kbd>Ctrl</kbd>+<kbd>/</kbd> to close
        </div>
      </div>
    </>
  );
}
