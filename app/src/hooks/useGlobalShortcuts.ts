import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

export interface ShortcutDef {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  label: string;
  category: string;
  action: () => void;
  /** Skip the shortcut when focus is inside an input/textarea */
  skipInInput?: boolean;
}

/**
 * Centralized global keyboard shortcuts for the app.
 * Dispatches custom events for actions that live in other components.
 */
export function useGlobalShortcuts({
  toggleSidebar,
}: {
  toggleSidebar: () => void;
}) {
  const navigate = useNavigate();

  const shortcuts: ShortcutDef[] = [
    // ── Navigation ──
    {
      key: "1",
      ctrl: true,
      label: "Go to Inbox",
      category: "Navigation",
      action: () => navigate("/"),
      skipInInput: true,
    },
    {
      key: "2",
      ctrl: true,
      label: "Go to Today",
      category: "Navigation",
      action: () => navigate("/today"),
      skipInInput: true,
    },
    {
      key: "3",
      ctrl: true,
      label: "Go to Dashboard",
      category: "Navigation",
      action: () => navigate("/dashboard"),
      skipInInput: true,
    },
    // ── Actions ──
    {
      key: "n",
      ctrl: true,
      label: "New task",
      category: "Actions",
      action: () => window.dispatchEvent(new CustomEvent("todoai:focus-new-task")),
    },
    {
      key: "k",
      ctrl: true,
      label: "Search",
      category: "Actions",
      action: () => window.dispatchEvent(new CustomEvent("todoai:focus-search")),
    },
    {
      key: "j",
      ctrl: true,
      label: "Toggle assistant",
      category: "Actions",
      action: () => window.dispatchEvent(new CustomEvent("todoai:toggle-chatbot")),
    },
    // ── Layout ──
    {
      key: "b",
      ctrl: true,
      label: "Toggle sidebar",
      category: "Layout",
      action: toggleSidebar,
    },
    {
      key: "/",
      ctrl: true,
      label: "Show shortcuts",
      category: "Help",
      action: () => window.dispatchEvent(new CustomEvent("todoai:toggle-shortcuts")),
    },
  ];

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      for (const s of shortcuts) {
        const ctrlMatch = s.ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey;
        const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = s.alt ? e.altKey : !e.altKey;

        if (e.key.toLowerCase() === s.key && ctrlMatch && shiftMatch && altMatch) {
          if (s.skipInInput) {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
              continue;
            }
          }
          e.preventDefault();
          s.action();
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, toggleSidebar]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return shortcuts;
}
