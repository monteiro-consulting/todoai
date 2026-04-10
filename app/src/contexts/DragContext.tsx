import { createContext, useContext, useState, useRef, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  pointerWithin,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragEndEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

interface DragState {
  activeId: string | null;
  overId: string | null;
  offsetX: number;
  startDepth: number;
}

interface ReorderInfo {
  getResult: () => { parentId: string | null; position: number; activeTask: any } | null;
  onUpdate: () => void;
}

interface DragContextValue extends DragState {
  registerReorder: (info: ReorderInfo | null) => void;
}

const Ctx = createContext<DragContextValue>({
  activeId: null,
  overId: null,
  offsetX: 0,
  startDepth: 0,
  registerReorder: () => {},
});

export function useDragState() {
  return useContext(Ctx);
}

// Priority: if pointer is within a project drop zone, use that; otherwise closestCenter for tasks
const customCollision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  const projectHit = pointer.find((c) => c.id.toString().startsWith("project-drop:"));
  if (projectHit) return [projectHit];
  return closestCenter(args);
};

export function DragProvider({ children, onMoveToProject }: {
  children: React.ReactNode;
  onMoveToProject?: (taskId: string, projectId: string, oldProjectId?: string | null) => Promise<void>;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const startDepthRef = useRef(0);
  const reorderRef = useRef<ReorderInfo | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const registerReorder = useCallback((info: ReorderInfo | null) => {
    reorderRef.current = info;
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    setActiveId(id);
    setOverId(id);
    setOffsetX(0);
    startDepthRef.current = 0; // will be overridden by SortableTaskList
  };

  const handleDragMove = (event: DragMoveEvent) => {
    setOffsetX(event.delta.x);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverId((event.over?.id as string) || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const over = event.over;
    const draggedId = activeId;

    setActiveId(null);
    setOverId(null);
    setOffsetX(0);

    if (!over || !draggedId) return;

    const overId = over.id as string;

    // Dropped on a sidebar project
    if (overId.startsWith("project-drop:")) {
      const projectId = overId.replace("project-drop:", "");
      if (onMoveToProject) {
        // Get old project_id from the active task
        const reorder = reorderRef.current;
        const result = reorder?.getResult();
        const oldProjectId = result?.activeTask?.project_id || null;
        await onMoveToProject(draggedId, projectId, oldProjectId);
      }
      return;
    }

    // Regular task reorder
    const reorder = reorderRef.current;
    if (!reorder) return;
    const result = reorder.getResult();
    if (!result) return;

    const { parentId, position, activeTask } = result;
    if (!activeTask) return;

    // Skip if nothing changed (same position, same parent)
    if (event.active.id === over.id) {
      const currentParent = activeTask.parent_task_id || null;
      if (parentId === currentParent) return;
    }

    const { api } = await import("../api/client");
    const params: Record<string, string> = {};
    if (activeTask.project_id) params.project_id = activeTask.project_id;
    if (parentId) params.parent_task_id = parentId;
    params.position = String(position);

    try {
      await api.moveTask(activeTask.id, params);
      reorder.onUpdate();
    } catch (err) {
      console.error("Failed to move task:", err);
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
  };

  const value: DragContextValue = {
    activeId,
    overId,
    offsetX,
    startDepth: startDepthRef.current,
    registerReorder,
  };

  // Expose startDepthRef so SortableTaskList can write to it
  (value as any)._startDepthRef = startDepthRef;

  return (
    <Ctx.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={customCollision}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
      </DndContext>
    </Ctx.Provider>
  );
}
