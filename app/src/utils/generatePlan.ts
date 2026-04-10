import { api, type SubtaskProposal } from "../api/client";
import type { Task, Project } from "../types";

export type { SubtaskProposal };

/**
 * Phase 1: Generate subtask proposals for review (nothing is created).
 * Returns the proposals so the user can edit/remove/reorder before confirming.
 */
export async function generatePlanPreview(
  task: Task,
  project?: Pick<Project, "name" | "notes"> | null,
): Promise<SubtaskProposal[]> {
  const result = await api.planPreview(task.id, {
    project_name: project?.name ?? undefined,
    project_notes: project?.notes ?? undefined,
  });

  return result.proposals;
}

/**
 * Phase 2: Confirm and create the reviewed subtasks.
 * Called after the user has reviewed/edited the plan preview.
 */
export async function confirmPlanSubtasks(
  taskId: string,
  subtasks: SubtaskProposal[],
): Promise<number> {
  const result = await api.planConfirm(taskId, subtasks);
  return result.count;
}

/**
 * Legacy: Generate and immediately create subtasks (no preview).
 */
export async function generatePlanForTask(
  task: Task,
  project?: Pick<Project, "name" | "notes"> | null,
): Promise<number> {
  const result = await api.generatePlan(task.id, {
    project_name: project?.name ?? undefined,
    project_notes: project?.notes ?? undefined,
  });

  return result.count;
}

/**
 * Check if a task needs plan generation (has no active subtasks).
 */
export function taskNeedsPlan(task: Task): boolean {
  const activeSubtasks = (task.subtasks || []).filter(
    (st) => st.status !== "done" && st.status !== "archived",
  );
  return activeSubtasks.length === 0;
}

/**
 * Auto-plan: generate subtasks automatically in one step.
 * Uses the /auto-plan endpoint which skips if subtasks already exist.
 * Returns the count of subtasks (existing or newly created).
 */
export async function autoPlan(
  task: Task,
  project?: Pick<Project, "name" | "notes"> | null,
): Promise<{ count: number; subtasks: any[] }> {
  const result = await api.autoPlan(task.id, {
    project_name: project?.name ?? undefined,
    project_notes: project?.notes ?? undefined,
  });
  return { count: result.count, subtasks: result.subtasks };
}

/**
 * Ensure a task has a plan (subtasks) before coding.
 * Uses auto-plan endpoint which generates subtasks if none exist,
 * or returns existing active subtasks.
 * Returns the refreshed task with subtasks.
 */
export async function ensurePlan(
  task: Task,
  project?: Pick<Project, "name" | "notes"> | null,
): Promise<Task> {
  if (!taskNeedsPlan(task)) {
    return task;
  }

  await autoPlan(task, project);

  // Re-fetch the task to get the newly created subtasks
  const updated = await api.getTask(task.id);
  return updated;
}
