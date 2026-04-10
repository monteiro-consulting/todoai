import { useState, useRef, useEffect } from "react";
import { generateContextForTasks, hasChildren, allHaveContext } from "../utils/generateContext";
import type { Task, Project } from "../types";

const WandIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>
  </svg>
);

const SpinnerIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4m-3.93 7.07l-2.83-2.83M7.76 7.76L4.93 4.93"/></svg>
);

interface Props {
  tasks: Task[];
  project?: Pick<Project, "name" | "notes"> | null;
  onDone: () => void;
  /** If true, always show the dropdown (for pages with task lists). If false, only show if task has subtasks. */
  alwaysShowMenu?: boolean;
  iconSize?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function GenerateContextButton({ tasks, project, onDone, alwaysShowMenu = false, iconSize = 14, className = "secondary", style }: Props) {
  const [generating, setGenerating] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const allFilled = allHaveContext(tasks);
  const showMenu = alwaysShowMenu || hasChildren(tasks);

  useEffect(() => {
    if (!menu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menu]);

  const generate = async (deep: boolean) => {
    setMenu(null);
    setGenerating(true);
    try {
      await generateContextForTasks(tasks, project, deep, allFilled);
      onDone();
    } catch (err: any) {
      console.error("Failed to generate context:", err);
      alert("Erreur: " + (err.message || err));
    } finally {
      setGenerating(false);
    }
  };

  const handleClick = () => {
    if (generating) return;
    if (showMenu) {
      if (menu) {
        setMenu(null);
      } else {
        const rect = btnRef.current?.getBoundingClientRect();
        if (rect) {
          setMenu({ x: rect.right, y: rect.bottom + 4 });
        }
      }
    } else {
      generate(true);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        className={`${className} ${generating ? "generating" : ""}`}
        disabled={generating}
        style={{ display: "flex", alignItems: "center", gap: 4, color: allFilled ? "var(--green)" : undefined, ...style }}
        onClick={handleClick}
      >
        {generating ? <SpinnerIcon size={iconSize} /> : <WandIcon size={iconSize} />}
      </button>
      {menu && (
        <div
          ref={menuRef}
          className="ctx-menu"
          style={{ top: menu.y, left: menu.x, transform: "translateX(-100%)" }}
        >
          <button onClick={() => generate(false)}>Tasks only</button>
          <button onClick={() => generate(true)}>Tasks + subtasks</button>
        </div>
      )}
    </>
  );
}
