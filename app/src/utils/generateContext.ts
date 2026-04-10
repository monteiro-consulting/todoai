import { invoke } from "@tauri-apps/api/core";
import { api } from "../api/client";
import type { Task, Project } from "../types";

interface TaskToFill {
  id: string;
  title: string;
  tags: string[];
  impact: number;
  effort: number;
}

/** Recursively collect tasks (and subtasks). Skips done tasks. If force=false, only those without notes. */
function collectTasks(tasks: Task[], deep: boolean, force: boolean): TaskToFill[] {
  const result: TaskToFill[] = [];
  for (const task of tasks) {
    if (task.status === "done" || task.status === "archived") continue;
    if (force || !task.notes) {
      result.push({
        id: task.id,
        title: task.title,
        tags: task.tags,
        impact: task.impact,
        effort: task.effort,
      });
    }
    if (deep && task.subtasks?.length) {
      result.push(...collectTasks(task.subtasks, true, force));
    }
  }
  return result;
}

function buildPrompt(
  tasksToFill: TaskToFill[],
  projectName?: string,
  projectNotes?: string | null,
  update = false,
): string {
  const action = update
    ? "mets a jour et ameliore le contexte existant"
    : "genere un court contexte (2-3 phrases max) qui decrit concretement ce que la tache implique et le resultat attendu";

  let prompt =
    `Tu es un assistant de gestion de taches. Pour chaque tache ci-dessous, ${action}.\n\n`;

  if (projectName) {
    prompt += `Projet: ${projectName}\n`;
    if (projectNotes) {
      prompt += `Context du projet:\n${projectNotes}\n\n`;
    }
  }

  prompt += "Taches a documenter:\n";
  for (const t of tasksToFill) {
    prompt += `- ID: ${t.id} | Titre: "${t.title}"`;
    if (t.tags.length) prompt += ` | Tags: ${t.tags.join(", ")}`;
    prompt += ` | Impact: ${t.impact}/5 | Effort: ${t.effort}/5\n`;
  }

  prompt +=
    "\nReponds UNIQUEMENT avec un JSON valide (sans markdown, sans backticks) au format:\n" +
    '{"id1": "contexte...", "id2": "contexte..."}\n';

  return prompt;
}

/** Check if any task in the list has subtasks. */
export function hasChildren(tasks: Task[]): boolean {
  return tasks.some((t) => t.subtasks && t.subtasks.length > 0);
}

/** Check if all non-done tasks (and subtasks recursively) have notes. */
export function allHaveContext(tasks: Task[]): boolean {
  const active = tasks.filter((t) => t.status !== "done" && t.status !== "archived");
  if (active.length === 0) return false;
  return active.every((t) => {
    if (!t.notes) return false;
    if (t.subtasks?.length) return allHaveContext(t.subtasks);
    return true;
  });
}

/**
 * Generate context for a list of tasks using Claude CLI.
 * @param deep - if true (default), also fills subtasks recursively. If false, only top-level tasks.
 * @param force - if true, update context even for tasks that already have notes.
 * Returns the number of tasks updated.
 */
export async function generateContextForTasks(
  tasks: Task[],
  project?: Pick<Project, "name" | "notes"> | null,
  deep = true,
  force = false,
): Promise<number> {
  const toFill = collectTasks(tasks, deep, force);
  if (toFill.length === 0) return 0;

  const prompt = buildPrompt(toFill, project?.name, project?.notes, force);

  const response = await invoke<string>("exec_claude", {
    cwd: "C:\\Users\\vmont\\todoto",
    prompt,
    continueConversation: false,
  });

  // Parse JSON — Claude might wrap it in backticks
  let jsonStr = response.trim();
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  const parsed: Record<string, string> = JSON.parse(jsonStr);

  let count = 0;
  for (const [id, notes] of Object.entries(parsed)) {
    if (notes && typeof notes === "string") {
      await api.updateTask(id, { notes });
      count++;
    }
  }

  return count;
}
