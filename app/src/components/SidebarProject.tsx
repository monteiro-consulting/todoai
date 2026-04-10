import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useDroppable } from "@dnd-kit/core";
import { api } from "../api/client";
import type { Project } from "../types";

const COLORS = [
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e", "#ef4444", "#f97316",
  "#eab308", "#84cc16", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6", "#6474ed", "#888888",
];

interface Props {
  project: Project;
  depth?: number;
  isNew?: boolean;
  onDone: () => void;
  onAddSub?: (parentId: string) => void;
}

export default function SidebarProject({ project, depth = 0, isNew, onDone, onAddSub }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [editing, setEditing] = useState(isNew || false);
  const [name, setName] = useState(isNew ? "" : project.name);
  const [showColors, setShowColors] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const { setNodeRef, isOver } = useDroppable({
    id: `project-drop:${project.id}`,
  });

  useEffect(() => {
    if (!editing) setName(project.name);
  }, [project.name]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      if (isNew) { onDone(); return; }
      setName(project.name);
      setEditing(false);
      return;
    }
    if (isNew) {
      try {
        const data: any = { name: trimmed, color: project.color };
        if (project.parent_project_id) data.parent_project_id = project.parent_project_id;
        await api.createProject(data);
      } catch (err) {
        console.error("Failed to create project:", err);
      }
      onDone();
      return;
    }
    if (trimmed !== project.name) {
      await api.updateProject(project.id, { name: trimmed });
      onDone();
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); saveName(); }
    if (e.key === "Escape") { setName(project.name); setEditing(false); if (isNew) onDone(); }
  };

  // Close context menu on click outside
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const handleDelete = async () => {
    setCtxMenu(null);
    try {
      await api.deleteProject(project.id);
      if (location.pathname === `/project/${project.id}`) {
        navigate("/");
      }
      onDone();
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  };

  const handleRename = () => {
    setCtxMenu(null);
    setEditing(true);
  };

  const pickColor = async (color: string) => {
    await api.updateProject(project.id, { color });
    setShowColors(false);
    onDone();
  };

  const hasSubs = project.subprojects && project.subprojects.length > 0;
  const isActive = location.pathname === `/project/${project.id}`;

  return (
    <div className="sidebar-project" ref={setNodeRef}>
      <div
        className={`sidebar-link${isActive ? " active" : ""}${isOver ? " drop-over" : ""}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => { if (!editing) navigate(`/project/${project.id}`); }}
        onDoubleClick={(e) => { e.preventDefault(); setEditing(true); }}
        onContextMenu={handleContextMenu}
      >
        {hasSubs && (
          <span
            className="sidebar-expand"
            onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
          >
            {collapsed ? "▸" : "▾"}
          </span>
        )}
        <span
          className="project-dot"
          style={{ backgroundColor: project.color }}
          onClick={(e) => { e.stopPropagation(); setShowColors(!showColors); }}
        />
        {editing ? (
          <input
            ref={inputRef}
            className="sidebar-rename-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={saveName}
            placeholder="name"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="sidebar-project-name">{project.name}</span>
        )}
        {onAddSub && !editing && (
          <span
            className="sidebar-add-sub"
            title="Add sub-project"
            onClick={(e) => { e.stopPropagation(); onAddSub(project.id); }}
          >+</span>
        )}
      </div>
      {showColors && (
        <div className="color-picker" style={{ marginLeft: depth * 16 }}>
          {COLORS.map((c) => (
            <span
              key={c}
              className={`color-swatch ${c === project.color ? "active" : ""}`}
              style={{ backgroundColor: c }}
              onClick={() => pickColor(c)}
            />
          ))}
        </div>
      )}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          <button onClick={handleRename}>Rename</button>
          <button className="ctx-danger" onClick={handleDelete}>Delete</button>
        </div>
      )}
      {hasSubs && !collapsed && (
        project.subprojects.map((sub) => (
          <SidebarProject
            key={sub.id}
            project={sub}
            depth={depth + 1}
            onDone={onDone}
            onAddSub={onAddSub}
          />
        ))
      )}
    </div>
  );
}
