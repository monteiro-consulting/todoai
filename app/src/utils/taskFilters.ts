import type { Task, TaskFilters, SortMode } from "../types";

export function filterTasks(tasks: Task[], filters: TaskFilters): Task[] {
  return tasks.filter((t) => {
    if (filters.status === "open" && t.status !== "open" && t.status !== "waiting" && t.status !== "in_progress" && t.status !== "goai") return false;
    if (filters.status === "waiting" && t.status !== "waiting") return false;
    if (filters.status === "in_progress" && t.status !== "in_progress") return false;
    if (filters.status === "goai" && t.status !== "goai") return false;
    if (filters.status === "done" && t.status !== "done") return false;
    if (filters.status === "late") {
      if (t.status === "done") return false;
      if (!t.due_at || new Date(t.due_at) >= new Date()) return false;
    }
    if (filters.tags.length > 0 && !filters.tags.some((tag) => t.tags.includes(tag))) return false;
    if (t.impact < filters.impactRange[0] || t.impact > filters.impactRange[1]) return false;
    if (t.effort < filters.effortRange[0] || t.effort > filters.effortRange[1]) return false;
    return true;
  });
}

export function sortTasks(tasks: Task[], mode: SortMode): Task[] {
  const sorted = [...tasks];
  switch (mode) {
    case "score":
      return sorted.sort((a, b) => {
        const sa = a.status === "done" ? -1 : a.score;
        const sb = b.status === "done" ? -1 : b.score;
        return sb - sa;
      });
    case "due":
      return sorted.sort((a, b) => {
        if (!a.due_at && !b.due_at) return b.score - a.score;
        if (!a.due_at) return 1;
        if (!b.due_at) return -1;
        return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      });
    case "created":
      return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    case "manual":
      return sorted.sort((a, b) => a.position - b.position);
    default:
      return sorted;
  }
}

export function extractAllTags(tasks: Task[]): string[] {
  const tagSet = new Set<string>();
  for (const t of tasks) {
    for (const tag of t.tags) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}
