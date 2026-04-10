import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { useLiveSync } from "./useLiveSync";
import type { Project } from "../types";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listProjects();
      setProjects(data);
    } catch (e) {
      console.error("Failed to load projects", e);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useLiveSync("project", refresh);

  return { projects, loading, refresh };
}
