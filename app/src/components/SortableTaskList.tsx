import { useState, useMemo, useEffect } from "react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDragState } from "../contexts/DragContext";
import TaskItem from "./TaskItem";
import type { Task, SortMode } from "../types";

interface Props {
  tasks: Task[];
  sortMode: SortMode;
  onUpdate: () => void;
}

interface FlatItem {
  task: Task;
  depth: number;
}

const INDENT = 50;

function flatten(tasks: Task[], depth: number, collapsed: Set<string>): FlatItem[] {
  const out: FlatItem[] = [];
  for (const t of tasks) {
    out.push({ task: t, depth });
    if (t.subtasks?.length && !collapsed.has(t.id)) {
      out.push(...flatten(t.subtasks, depth + 1, collapsed));
    }
  }
  return out;
}

function withoutActiveTree(flatItems: FlatItem[], activeId: string): FlatItem[] {
  const idx = flatItems.findIndex((f) => f.task.id === activeId);
  if (idx === -1) return flatItems;
  const activeDepth = flatItems[idx].depth;
  const result: FlatItem[] = [];
  let skipping = false;
  for (let i = 0; i < flatItems.length; i++) {
    if (i === idx) { skipping = true; continue; }
    if (skipping && flatItems[i].depth > activeDepth) continue;
    skipping = false;
    result.push(flatItems[i]);
  }
  return result;
}

function computeProjection(
  flatItems: FlatItem[],
  activeId: string,
  overId: string,
  rawDepth: number
): { parentId: string | null; position: number; clampedDepth: number; lineItemId: string; linePosition: "above" | "below" } | null {
  const activeIdx = flatItems.findIndex((f) => f.task.id === activeId);
  const overIdx = flatItems.findIndex((f) => f.task.id === overId);
  if (activeIdx === -1 || overIdx === -1) return null;

  const cleaned = withoutActiveTree(flatItems, activeId);

  if (activeId === overId) {
    const neighborIdx = Math.min(activeIdx, cleaned.length - 1);
    const maxDepth = neighborIdx > 0 ? cleaned[neighborIdx - 1].depth + 1 : 0;
    const clampedDepth = Math.max(0, Math.min(maxDepth, rawDepth));

    let parentId: string | null = null;
    if (clampedDepth > 0) {
      for (let i = neighborIdx - 1; i >= 0; i--) {
        if (cleaned[i].depth === clampedDepth - 1) { parentId = cleaned[i].task.id; break; }
        if (cleaned[i].depth < clampedDepth - 1) break;
      }
      if (!parentId) return { parentId: null, position: 0, clampedDepth: 0, lineItemId: activeId, linePosition: "below" };
    }

    let position = 0;
    for (let i = 0; i < neighborIdx; i++) {
      const p = cleaned[i].task.parent_task_id || null;
      if (p === parentId && cleaned[i].depth === clampedDepth) position++;
    }

    return { parentId, position, clampedDepth, lineItemId: activeId, linePosition: "below" };
  }

  const overInCleaned = cleaned.findIndex((f) => f.task.id === overId);
  if (overInCleaned === -1) return null;

  const overItemDepth = cleaned[overInCleaned].depth;
  const wantsToNest = rawDepth > overItemDepth;
  const insertIdx = (activeIdx < overIdx || wantsToNest) ? overInCleaned + 1 : overInCleaned;

  const maxDepth = insertIdx > 0 ? cleaned[insertIdx - 1].depth + 1 : 0;
  const clampedDepth = Math.max(0, Math.min(maxDepth, rawDepth));

  let parentId: string | null = null;
  if (clampedDepth > 0) {
    for (let i = insertIdx - 1; i >= 0; i--) {
      if (cleaned[i].depth === clampedDepth - 1) { parentId = cleaned[i].task.id; break; }
      if (cleaned[i].depth < clampedDepth - 1) break;
    }
    if (!parentId) return { parentId: null, position: 0, clampedDepth: 0, lineItemId: overId, linePosition: "above" };
  }

  let position = 0;
  for (let i = 0; i < insertIdx; i++) {
    const p = cleaned[i].task.parent_task_id || null;
    if (p === parentId && cleaned[i].depth === clampedDepth) position++;
  }

  const linePosition = insertIdx > overInCleaned ? "below" as const : "above" as const;
  return { parentId, position, clampedDepth, lineItemId: overId, linePosition };
}

export default function SortableTaskList({ tasks, sortMode, onUpdate }: Props) {
  // Start with all parent tasks collapsed
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    for (const t of tasks) {
      if (t.subtasks && t.subtasks.length > 0) ids.add(t.id);
    }
    return ids;
  });
  const dragCtx = useDragState();
  const { activeId, overId, offsetX, registerReorder } = dragCtx;
  const startDepthRef = (dragCtx as any)._startDepthRef;

  const toggleExpand = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const flatItems = useMemo(
    () => flatten(tasks, 0, collapsed),
    [tasks, collapsed]
  );

  // Set start depth when drag starts on one of our items
  useEffect(() => {
    if (activeId && startDepthRef) {
      const item = flatItems.find((f) => f.task.id === activeId);
      if (item) startDepthRef.current = item.depth;
    }
  }, [activeId, flatItems, startDepthRef]);

  const projected = useMemo(() => {
    if (!activeId || !overId) return null;
    // If overId is a project drop target, no projection
    if ((overId as string).startsWith("project-drop:")) return null;
    const rawDepth = (startDepthRef?.current || 0) + Math.round(offsetX / INDENT);
    return computeProjection(flatItems, activeId, overId, rawDepth);
  }, [flatItems, activeId, overId, offsetX, startDepthRef]);

  // Register reorder handler so DragProvider can call it on drop
  useEffect(() => {
    registerReorder({
      getResult: () => {
        if (!projected || !activeId) return null;
        const activeTask = flatItems.find((f) => f.task.id === activeId)?.task || null;
        return { parentId: projected.parentId, position: projected.position, activeTask };
      },
      onUpdate,
    });
    return () => registerReorder(null);
  }, [projected, activeId, flatItems, onUpdate, registerReorder]);

  const dropLineTarget = useMemo(() => {
    if (!activeId || !projected) return null;
    return { id: projected.lineItemId, depth: projected.clampedDepth, position: projected.linePosition };
  }, [activeId, projected]);

  return (
    <SortableContext items={flatItems.map((f) => f.task.id)} strategy={verticalListSortingStrategy}>
      {flatItems.map((item) => (
        <TaskItem
          key={item.task.id}
          task={item.task}
          onUpdate={onUpdate}
          sortMode={sortMode}
          depth={item.depth}
          isExpanded={!collapsed.has(item.task.id)}
          onToggleExpand={() => toggleExpand(item.task.id)}
          dropLineDepth={dropLineTarget?.id === item.task.id ? dropLineTarget.depth : undefined}
          dropLinePosition={dropLineTarget?.id === item.task.id ? dropLineTarget.position : undefined}
        />
      ))}
    </SortableContext>
  );
}
