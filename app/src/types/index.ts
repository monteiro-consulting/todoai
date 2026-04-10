export interface Project {
  id: string;
  parent_project_id: string | null;
  category: string | null;
  name: string;
  color: string;
  notes: string | null;
  local_path: string | null;
  created_at: string;
  updated_at: string;
  subprojects: Project[];
}

export interface TaskTrigger {
  id: string;
  source_task_id: string;
  target_task_id: string;
  created_at: string;
}

export interface TaskRef {
  id: string;
  title: string;
  status: string;
  project_id: string | null;
}

export interface Task {
  id: string;
  project_id: string | null;
  parent_task_id: string | null;
  title: string;
  notes: string | null;
  status: "open" | "waiting" | "in_progress" | "goai" | "done" | "archived";
  due_at: string | null;
  impact: number;
  effort: number;
  priority: number;
  score: number;
  tags: string[];
  estimate_min: number;
  position: number;
  triggers_goai_task_id: string | null;
  critical: boolean;
  trigger_mode: "or" | "and";
  trigger_goai: boolean;
  created_at: string;
  updated_at: string;
  subtasks: Task[];
  triggers_in: TaskTrigger[];
  triggers_out: TaskTrigger[];
  dependencies: TaskRef[];
}

export type SortMode = "score" | "due" | "created" | "manual";

export interface TaskFilters {
  status: "open" | "waiting" | "in_progress" | "goai" | "done" | "late" | "all";
  tags: string[];
  impactRange: [number, number];
  effortRange: [number, number];
}

export const defaultFilters: TaskFilters = {
  status: "open",
  tags: [],
  impactRange: [1, 5],
  effortRange: [1, 5],
};

export interface PlannedTask {
  task_id: string;
  title: string;
  start_at: string;
  end_at: string;
  score: number;
}

export interface PlanResult {
  tasks: PlannedTask[];
  total_minutes: number;
  remaining_minutes: number;
}
