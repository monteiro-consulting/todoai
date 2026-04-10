export interface DueDateInfo {
  label: string;
  className: string;
}

export function formatDueDate(dateStr: string | null | undefined, status?: string): DueDateInfo | null {
  if (!dateStr) return null;
  if (status === "done") return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(dateStr);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

  const diffMs = dueDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { label: "overdue", className: "due-overdue" };
  }
  if (diffDays === 0) {
    return { label: "today", className: "due-today" };
  }
  if (diffDays === 1) {
    return { label: "tomorrow", className: "due-tomorrow" };
  }
  if (diffDays <= 7) {
    return { label: `in ${diffDays}d`, className: "due-soon" };
  }

  const formatted = dueDay.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { label: formatted, className: "due-later" };
}
