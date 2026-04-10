import { Routes, Route, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useProjects } from "./hooks/useProjects";
import InboxPage from "./pages/InboxPage";
import ProjectPage from "./pages/ProjectPage";
import TodayPage from "./pages/TodayPage";
import TaskDetailPage from "./pages/TaskDetailPage";
import DashboardPage from "./pages/DashboardPage";
import TitleBar from "./components/TitleBar";
import { ProjectProvider } from "./contexts/ProjectContext";
import { DragProvider } from "./contexts/DragContext";
import { FlowProvider } from "./contexts/ReactFlowContext";
import SidebarProject from "./components/SidebarProject";
import SearchBar from "./components/SearchBar";
import ChatBot from "./components/ChatBot";
import ShortcutsHelp from "./components/ShortcutsHelp";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useState, useCallback, useMemo, useEffect } from "react";
import { api } from "./api/client";
import { UndoProvider, useUndo } from "./contexts/UndoContext";
import type { Project } from "./types";

export default function App() {
  const { projects, refresh: refreshProjects } = useProjects();
  const [newProject, setNewProject] = useState<Project | null>(null);
  const [newProjectParent, setNewProjectParent] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const findProject = (list: Project[], id: string): Project | null => {
    for (const p of list) {
      if (p.id === id) return p;
      if (p.subprojects?.length) {
        const found = findProject(p.subprojects, id);
        if (found) return found;
      }
    }
    return null;
  };

  const handleAddProject = (parentId?: string) => {
    let color = "#6366f1";
    if (parentId) {
      const parent = findProject(projects, parentId);
      if (parent) color = parent.color;
    }
    const placeholder: Project = {
      id: `temp-${Date.now()}`,
      parent_project_id: parentId || null,
      category: null,
      name: "",
      color,
      notes: null,
      local_path: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      subprojects: [],
    };
    setNewProject(placeholder);
    setNewProjectParent(parentId || null);
  };

  const handleNewProjectDone = () => {
    setNewProject(null);
    setNewProjectParent(null);
    refreshProjects();
  };

  const { pushUndo } = useUndo();

  const handleMoveToProject = useCallback(async (taskId: string, projectId: string, oldProjectId?: string | null) => {
    try {
      await api.updateTask(taskId, { project_id: projectId });
      pushUndo({
        label: "move task",
        fn: async () => {
          await api.updateTask(taskId, { project_id: oldProjectId || null });
        },
      });
    } catch (err) {
      console.error("Failed to move task to project:", err);
    }
  }, [pushUndo]);

  // Group projects by category
  const { categorized, uncategorized } = useMemo(() => {
    const cats: Record<string, Project[]> = {};
    const uncat: Project[] = [];
    for (const p of projects) {
      if (p.category) {
        if (!cats[p.category]) cats[p.category] = [];
        cats[p.category].push(p);
      } else {
        uncat.push(p);
      }
    }
    return { categorized: cats, uncategorized: uncat };
  }, [projects]);

  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const toggleCat = (cat: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Sidebar collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("sidebarCollapsed") === "true";
  });

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // Global keyboard shortcuts (Ctrl+N, Ctrl+K, Ctrl+B, Ctrl+J, Ctrl+1/2/3, Ctrl+/)
  const shortcuts = useGlobalShortcuts({
    toggleSidebar: () => setSidebarCollapsed((prev) => !prev),
  });

  return (
    <FlowProvider>
    <ProjectProvider projects={projects}>
    <DragProvider onMoveToProject={handleMoveToProject}>
    <div className="app-shell">
      <TitleBar />
      <div className="app-layout">
      {/* Mobile overlay backdrop */}
      {!sidebarCollapsed && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}
      <nav className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
        <div className="sidebar-header">
          <h1>TodoAI</h1>
          <button
            className="sidebar-collapse-btn"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            title="Toggle sidebar (Ctrl+B)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {sidebarCollapsed
                ? <><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></>
                : <><polyline points="11 17 6 12 11 7"/><line x1="6" y1="12" x2="18" y2="12"/></>
              }
            </svg>
          </button>
        </div>
        <NavLink to="/" className={({ isActive }) => isActive ? "active" : ""}>
          Inbox
        </NavLink>
        <NavLink to="/today" className={({ isActive }) => isActive ? "active" : ""}>
          Today
        </NavLink>
        <NavLink to="/dashboard" className={({ isActive }) => isActive ? "active" : ""}>
          Dashboard
        </NavLink>
        <div className="sidebar-section-header">
          <span>Projects</span>
          <button className="sidebar-add-btn" onClick={() => handleAddProject()}>+</button>
        </div>

        {/* Uncategorized projects */}
        {uncategorized.map((p) => (
          <SidebarProject
            key={p.id}
            project={p}
            onDone={refreshProjects}
            onAddSub={(parentId) => handleAddProject(parentId)}
          />
        ))}

        {/* Categorized projects */}
        {Object.entries(categorized).map(([cat, catProjects]) => (
          <div key={cat}>
            <div
              className="sidebar-category"
              onClick={() => toggleCat(cat)}
            >
              <span className="sidebar-expand">{collapsedCats.has(cat) ? "▸" : "▾"}</span>
              <span>{cat}</span>
            </div>
            {!collapsedCats.has(cat) && catProjects.map((p) => (
              <SidebarProject
                key={p.id}
                project={p}
                onDone={refreshProjects}
                onAddSub={(parentId) => handleAddProject(parentId)}
              />
            ))}
          </div>
        ))}

        {/* New project being created */}
        {newProject && !newProjectParent && (
          <SidebarProject project={newProject} isNew onDone={handleNewProjectDone} />
        )}

        <div className="sidebar-spacer" />
      </nav>
      <div className="main-column">
        <main className="main-content">
          {sidebarCollapsed && (
            <button
              className="sidebar-open-btn"
              onClick={() => setSidebarCollapsed(false)}
              title="Open sidebar (Ctrl+B)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
          )}
          <SearchBar />
          <div className="page-transition" key={location.pathname}>
            <Routes location={location}>
              <Route path="/" element={<InboxPage />} />
              <Route path="/today" element={<TodayPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/project/:projectId" element={<ProjectPage />} />
              <Route path="/task/:taskId" element={<TaskDetailPage />} />
            </Routes>
          </div>
        </main>
      </div>
      </div>
    </div>
    <ChatBot />
    <ShortcutsHelp shortcuts={shortcuts} />
    </DragProvider>
    </ProjectProvider>
    </FlowProvider>
  );
}
