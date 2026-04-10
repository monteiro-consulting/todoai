import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { useTasks } from "../hooks/useTasks";
import { useProjects } from "../hooks/useProjects";
import { api } from "../api/client";
import TaskForm from "../components/TaskForm";
import DumpBox from "../components/DumpBox";
import FilterBar from "../components/FilterBar";
import SortableTaskList from "../components/SortableTaskList";
import KanbanBoard from "../components/KanbanBoard";
import MarkdownRenderer from "../components/MarkdownRenderer";
import GenerateContextButton from "../components/GenerateContextButton";
import SuggestionsPanel, { type SuggestionsPanelHandle } from "../components/SuggestionsPanel";
import { filterTasks, sortTasks, extractAllTags } from "../utils/taskFilters";
import { defaultFilters, type TaskFilters, type SortMode } from "../types";

type ViewMode = "list" | "kanban";

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { projects } = useProjects();
  const [filters, setFilters] = useState<TaskFilters>(defaultFilters);
  const [sortMode, setSortMode] = useState<SortMode>("score");
  const scrollPositions = useRef<Record<string, number>>({ list: 0, kanban: 0 });
  const splitRightRef = useRef<HTMLDivElement>(null);
  const kanbanFullRef = useRef<HTMLDivElement>(null);
  const [showContext, _setShowContext] = useState(() => localStorage.getItem("todoai_showContext") === "true");
  const setShowContext = (v: boolean) => { _setShowContext(v); localStorage.setItem("todoai_showContext", String(v)); };
  const [view, _setView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("todoai_view");
    return saved === "list" || saved === "kanban" ? saved : "list";
  });

  const getActiveScroller = useCallback(() => {
    return kanbanFullRef.current || splitRightRef.current;
  }, []);

  const setView = (v: ViewMode) => {
    // Save current scroll position before switching
    const currentScroller = getActiveScroller();
    if (currentScroller) {
      scrollPositions.current[view] = currentScroller.scrollTop;
    }
    _setView(v);
    localStorage.setItem("todoai_view", v);
  };
  const [showDump, setShowDump] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [localPath, setLocalPath] = useState("");
  const suggestionsRef = useRef<SuggestionsPanelHandle>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore scroll position after view switch
  useEffect(() => {
    const savedScroll = scrollPositions.current[view];
    if (!savedScroll) return;
    requestAnimationFrame(() => {
      const scroller = getActiveScroller();
      if (scroller) {
        scroller.scrollTop = savedScroll;
      }
    });
  }, [view, getActiveScroller]);

  const fetchParams: Record<string, string> = { project_id: projectId! };
  if (view === "list" && filters.status !== "all" && filters.status !== "late") fetchParams.status = filters.status;

  const { tasks, loading, refresh } = useTasks(fetchParams);

  const project = projects.find((p) => p.id === projectId);

  // Sync notes and local_path from project when it loads
  useEffect(() => {
    if (project) {
      setNotes(project.notes || "");
      setLocalPath(project.local_path || "");
    }
  }, [project?.id]);

  const isFullwidth = view === "kanban";
  const hideContext = isFullwidth && !showContext;

  // Keyboard shortcut: Ctrl+B to toggle context panel in kanban view
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b" && isFullwidth) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setShowContext(!showContext);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isFullwidth, showContext]);

  const availableTags = extractAllTags(tasks);
  const filtered = filterTasks(tasks, filters);
  const sorted = sortTasks(filtered, sortMode);

  const handleNotesChange = useCallback((value: string) => {
    setNotes(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.updateProject(projectId!, { notes: value || null });
      } catch (err) {
        console.error("Failed to save notes:", err);
      }
    }, 800);
  }, [projectId]);

  const handleLocalPathChange = useCallback((value: string) => {
    setLocalPath(value);
    if (pathSaveTimer.current) clearTimeout(pathSaveTimer.current);
    pathSaveTimer.current = setTimeout(async () => {
      try {
        await api.updateProject(projectId!, { local_path: value || null });
      } catch (err) {
        console.error("Failed to save local_path:", err);
      }
    }, 800);
  }, [projectId]);

  const handleBrowseFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "Select project folder" });
      if (selected) {
        const path = typeof selected === "string" ? selected : selected;
        setLocalPath(path);
        await api.updateProject(projectId!, { local_path: path });
      }
    } catch (err) {
      console.error("Failed to open folder dialog:", err);
    }
  }, [projectId]);

  const contextPanel = (
    <div className="split-left">
      <div className="split-left-header">
        <h2>
          {project && <span className="project-dot" style={{ backgroundColor: project.color }} />}
          {project?.name || "Project"}
        </h2>
        {isFullwidth && (
          <button className="secondary context-close-btn" onClick={() => setShowContext(false)} title="Hide context">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>
      <div className="local-path-section">
        <div className="context-label">
          <span>Local path</span>
        </div>
        <div className="local-path-input-row">
          <input
            type="text"
            className="local-path-input"
            value={localPath}
            onChange={(e) => handleLocalPathChange(e.target.value)}
            placeholder="C:\Projects\my-project"
          />
          <button className="secondary local-path-browse-btn" onClick={handleBrowseFolder} title="Browse folder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          </button>
        </div>
      </div>
      <div className="context-section">
        <div className="context-label">
          <span>Context</span>
          <button
            className="secondary context-edit-btn"
            onClick={() => setEditingNotes(!editingNotes)}
          >
            {editingNotes ? "Preview" : "Edit"}
          </button>
        </div>
        {editingNotes ? (
          <textarea
            className="context-textarea"
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Project notes, context, links... (Markdown supported)"
          />
        ) : (
          <div
            className="context-preview"
            onClick={() => setEditingNotes(true)}
          >
            {notes ? (
              <MarkdownRenderer content={notes} />
            ) : (
              <span className="context-placeholder">Click to add project context...</span>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const headerContent = (
    <div className="split-right-header">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {isFullwidth && !showContext && (
          <button
            className="secondary kanban-context-toggle"
            onClick={() => setShowContext(true)}
            title="Show project context (notes)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
            Context
          </button>
        )}
        <GenerateContextButton
          tasks={tasks}
          project={project}
          onDone={refresh}
          alwaysShowMenu
          style={{ fontSize: 12, padding: "5px 10px" }}
        />
        <button
          className="secondary"
          onClick={() => suggestionsRef.current?.generate()}
          title="AI Suggestions"
          style={{ fontSize: 12, padding: "5px 10px" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 1l.5 1.5L21 3l-1.5.5L19 5l-.5-1.5L17 3l1.5-.5z"/>
          </svg>
        </button>
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
  );

  if (hideContext) {
    return (
      <div className="kanban-fullwidth" ref={kanbanFullRef}>
        {headerContent}
        <TaskForm projectId={projectId} onCreated={refresh} onDump={() => setShowDump((v) => !v)} />
        {showDump && <DumpBox projectId={projectId} onCreated={() => { refresh(); setShowDump(false); }} />}
        <SuggestionsPanel ref={suggestionsRef} projectId={projectId} onCreated={refresh} />
        {loading ? (
          <div className="empty-state">Loading...</div>
        ) : (
          <KanbanBoard tasks={tasks} onUpdate={refresh} />
        )}
      </div>
    );
  }

  return (
    <div className="split-pane">
      {contextPanel}

      {/* Right: Tasks */}
      <div className="split-right" ref={splitRightRef}>
        {headerContent}
        <TaskForm projectId={projectId} onCreated={refresh} onDump={() => setShowDump((v) => !v)} />
        {showDump && <DumpBox projectId={projectId} onCreated={() => { refresh(); setShowDump(false); }} />}
        <SuggestionsPanel ref={suggestionsRef} projectId={projectId} onCreated={refresh} />
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
              <div className="empty-state">Loading...</div>
            ) : sorted.length === 0 ? (
              <div className="empty-state">No tasks in this project</div>
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
    </div>
  );
}
