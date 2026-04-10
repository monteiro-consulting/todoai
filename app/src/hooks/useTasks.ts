import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { useLiveSync } from "./useLiveSync";
import type { Task } from "../types";

export function useTasks(params?: Record<string, string>) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listTasks(params);
      setTasks(data);
    } catch (e) {
      console.error("Failed to load tasks", e);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(params)]);

  useEffect(() => { refresh(); }, [refresh]);

  useLiveSync("task", refresh);

  return { tasks, loading, refresh };
}
