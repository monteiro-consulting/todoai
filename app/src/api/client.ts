export interface SubtaskProposal {
  title: string;
  notes: string | null;
  impact: number;
  effort: number;
  estimate_min: number;
  tags: string[];
}

export interface TaskSuggestion {
  title: string;
  reason: string;
  impact: number;
  effort: number;
  estimate_min: number;
  tags: string[];
  project_id: string | null;
}

const BASE = "http://127.0.0.1:18427/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return {} as T;
  return res.json();
}

export const api = {
  // Projects
  listProjects: () => request<any[]>("/projects"),
  createProject: (data: { name: string; color?: string; parent_project_id?: string; category?: string; local_path?: string }) =>
    request<any>("/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id: string, data: any) =>
    request<any>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: "DELETE" }),

  // Tasks
  listTasks: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request<any[]>(`/tasks${qs}`);
  },
  createTask: (data: any) =>
    request<any>("/tasks", { method: "POST", body: JSON.stringify(data) }),
  bulkCreateTasks: (tasks: any[]) =>
    request<any[]>("/tasks/bulk", { method: "POST", body: JSON.stringify({ tasks }) }),
  dumpCreate: (text: string, project_id?: string) =>
    request<any[]>("/tasks/dump", { method: "POST", body: JSON.stringify({ text, project_id }) }),
  getTask: (id: string) => request<any>(`/tasks/${id}`),
  updateTask: (id: string, data: any) =>
    request<any>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  completeTask: (id: string) =>
    request<{ task: any; triggered_tasks: any[]; next_goai_task: any | null }>(`/tasks/${id}/complete`, { method: "POST" }),
  deleteTask: (id: string) =>
    request<void>(`/tasks/${id}`, { method: "DELETE" }),
  moveTask: (id: string, params: Record<string, string>) =>
    request<any>(`/tasks/${id}/move?${new URLSearchParams(params)}`, { method: "POST" }),

  // Plan generation (subtask decomposition before coding)
  generatePlan: (taskId: string, data?: { project_name?: string; project_notes?: string }) =>
    request<{ parent_task_id: string; subtasks: any[]; count: number }>(
      `/tasks/${taskId}/generate-plan`,
      { method: "POST", body: JSON.stringify(data || {}) },
    ),
  planPreview: (taskId: string, data?: { project_name?: string; project_notes?: string }) =>
    request<{ parent_task_id: string; proposals: SubtaskProposal[]; count: number }>(
      `/tasks/${taskId}/plan-preview`,
      { method: "POST", body: JSON.stringify(data || {}) },
    ),
  planConfirm: (taskId: string, subtasks: SubtaskProposal[]) =>
    request<{ parent_task_id: string; subtasks: any[]; count: number }>(
      `/tasks/${taskId}/plan-confirm`,
      { method: "POST", body: JSON.stringify({ subtasks }) },
    ),
  autoPlan: (taskId: string, data?: { project_name?: string; project_notes?: string }) =>
    request<{ parent_task_id: string; subtasks: any[]; count: number }>(
      `/tasks/${taskId}/auto-plan`,
      { method: "POST", body: JSON.stringify(data || {}) },
    ),

  // Suggestions
  suggestTasks: (data?: { project_id?: string }) =>
    request<{ suggestions: TaskSuggestion[]; count: number }>(
      "/tasks/suggest",
      { method: "POST", body: JSON.stringify(data || {}) },
    ),

  // Trigger links
  addTrigger: (data: { source_task_id: string; target_task_id: string }) =>
    request<any>(`/tasks/_/triggers`, { method: "POST", body: JSON.stringify(data) }),
  removeTrigger: (taskId: string, triggerId: string) =>
    request<void>(`/tasks/${taskId}/triggers/${triggerId}`, { method: "DELETE" }),

  // Dependencies
  addDependency: (taskId: string, dependsOnId: string) =>
    request<any>(`/tasks/${taskId}/dependencies`, { method: "POST", body: JSON.stringify({ depends_on_id: dependsOnId }) }),
  removeDependency: (taskId: string, dependsOnId: string) =>
    request<void>(`/tasks/${taskId}/dependencies/${dependsOnId}`, { method: "DELETE" }),

  // Plan
  planToday: (data?: { available_minutes?: number; focus_project_id?: string }) =>
    request<any>("/plan/today", { method: "POST", body: JSON.stringify(data || {}) }),

  // Dependency Graph
  getDependencyGraph: (projectId?: string) => {
    const qs = projectId ? `?project_id=${projectId}` : "";
    return request<{
      nodes: { id: string; title: string; status: string; project_id: string | null; impact: number; effort: number; due_at: string | null }[];
      edges: { source: string; target: string; type: "dependency" | "trigger" }[];
    }>(`/tasks/dependency-graph${qs}`);
  },

  // Health
  health: () => request<{ status: string }>("/health"),
};
