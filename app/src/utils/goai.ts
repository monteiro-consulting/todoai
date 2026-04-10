import { invoke } from "@tauri-apps/api/core";
import type { Task, Project } from "../types";

/**
 * Build a prompt for a task, including subtasks if any.
 */
function buildPrompt(task: Task, project: Project | null, subtasks: SubtaskInfo[]): string {
  let prompt = `# Task: ${task.title}\n\n`;

  if (task.notes) {
    prompt += `## Task Context\n${task.notes}\n\n`;
  }

  if (task.tags.length > 0) {
    prompt += `Tags: ${task.tags.join(", ")}\n`;
  }

  if (project) {
    prompt += `\nProject: ${project.name}\n`;
    if (project.notes) {
      prompt += `\n## Project Context\n${project.notes}\n`;
    }
  }

  if (subtasks.length > 0) {
    prompt += `\n## Subtasks to complete\n`;
    for (let i = 0; i < subtasks.length; i++) {
      const st = subtasks[i];
      prompt += `\n### ${i + 1}. ${st.title}\n`;
      if (st.notes) prompt += `${st.notes}\n`;
      if (st.tags.length > 0) prompt += `Tags: ${st.tags.join(", ")}\n`;
    }
    prompt += `\n---\nPlease complete all subtasks above. Read the codebase as needed and implement the changes.`;
  } else {
    prompt += `\n---\nPlease complete this task. Read the codebase as needed and implement the changes.`;
  }

  return prompt;
}

interface SubtaskInfo {
  id: string;
  title: string;
  notes: string | null;
  tags: string[];
}

/**
 * Launch Claude agent in a terminal for a GoAi task.
 * One agent handles the parent task and all its subtasks.
 */
export async function launchGoAi(task: Task, projectMap: Record<string, Project>): Promise<boolean> {
  const project = task.project_id ? projectMap[task.project_id] : null;

  const localPath = project?.local_path || "C:\\Users\\vmont\\todoto";

  // Collect active subtasks
  const activeSubtasks: SubtaskInfo[] = (task.subtasks || [])
    .filter((st) => st.status !== "done" && st.status !== "archived")
    .map((st) => ({ id: st.id, title: st.title, notes: st.notes, tags: st.tags }));

  const prompt = buildPrompt(task, project, activeSubtasks);

  try {
    await invoke("launch_goai", {
      path: localPath,
      prompt,
      taskId: task.id,
      subtasks: activeSubtasks,
    });
    return true;
  } catch (err) {
    console.error("GoAi: Failed to launch terminal:", err);
    alert(`GoAi: Failed to launch terminal: ${err}`);
    return false;
  }
}
