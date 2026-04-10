import { useState, useRef, useEffect } from "react";
import { useTasks } from "../hooks/useTasks";
import TaskForm from "../components/TaskForm";
import DumpBox from "../components/DumpBox";
import FilterBar from "../components/FilterBar";
import SortableTaskList from "../components/SortableTaskList";
import KanbanBoard from "../components/KanbanBoard";
import GenerateContextButton from "../components/GenerateContextButton";
import SuggestionsPanel from "../components/SuggestionsPanel";
import { filterTasks, sortTasks, extractAllTags } from "../utils/taskFilters";
import { defaultFilters, type TaskFilters, type SortMode } from "../types";

type ViewMode = "list" | "kanban";

export default function InboxPage() {
  const [filters, setFilters] = useState<TaskFilters>(defaultFilters);
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const scrollPositions = useRef<Record<string, number>>({ list: 0, kanban: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, _setView] = useState<ViewMode>(() => (localStorage.getItem("todoai_view") as ViewMode) || "list");
  const setView = (v: ViewMode) => {
    // Save current scroll position before switching
    if (containerRef.current) {
      scrollPositions.current[view] = containerRef.current.scrollTop;
    }
    _setView(v);
    localStorage.setItem("todoai_view", v);
  };
  const [showDump, setShowDump] = useState(false);

  // Restore scroll position after view switch
  useEffect(() => {
    const savedScroll = scrollPositions.current[view];
    if (!savedScroll) return;
    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = savedScroll;
      }
    });
  }, [view]);

  const fetchParams: Record<string, string> = {};
  if (view === "list" && filters.status !== "all" && filters.status !== "late") fetchParams.status = filters.status;

  const { tasks, loading, refresh } = useTasks(fetchParams);

  const availableTags = extractAllTags(tasks);
  const filtered = filterTasks(tasks, filters);
  const sorted = sortTasks(filtered, sortMode);

  return (
    <div ref={containerRef}>
      <div className="header-row">
        <h2>Inbox</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <GenerateContextButton
            tasks={tasks}
            onDone={refresh}
            alwaysShowMenu
            style={{ fontSize: 12, padding: "5px 10px" }}
          />
          <div className="view-toggle">
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              List
            </button>
            <button className={view === "kanban" ? "active" : ""} onClick={() => setView("kanban")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg>
              Kanban
            </button>
          </div>
        </div>
      </div>
      <TaskForm onCreated={refresh} onDump={() => setShowDump((v) => !v)} />
      {showDump && <DumpBox onCreated={() => { refresh(); setShowDump(false); }} />}
      <SuggestionsPanel onCreated={refresh} />
      {view === "list" && (
        <>
          <FilterBar
            filters={filters}
            onFiltersChange={setFilters}
            sortMode={sortMode}
            onSortChange={setSortMode}
            availableTags={availableTags}
            tasks={tasks}
          />
          {loading ? (
            <div className="empty-state">
              <div className="suggestion-spinner" />
              Loading...
            </div>
          ) : sorted.length === 0 ? (
            <div className="empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}>
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
              </svg>
              <span>No tasks yet</span>
              <span style={{ fontSize: 12, opacity: 0.7 }}>Create one above or dump some text</span>
            </div>
          ) : (
            <SortableTaskList tasks={sorted} sortMode={sortMode} onUpdate={refresh} />
          )}
        </>
      )}
      {view === "kanban" && (
        loading ? (
          <div className="empty-state">Loading...</div>
        ) : (
          <KanbanBoard tasks={tasks} onUpdate={refresh} />
        )
      )}
    </div>
  );
}
