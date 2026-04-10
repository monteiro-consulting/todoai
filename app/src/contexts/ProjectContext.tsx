import { createContext, useContext, useMemo } from "react";
import type { Project } from "../types";

type ProjectMap = Record<string, Project>;

const ProjectContext = createContext<ProjectMap>({});

function flattenProjects(projects: Project[], map: ProjectMap) {
  for (const p of projects) {
    map[p.id] = p;
    if (p.subprojects?.length) flattenProjects(p.subprojects, map);
  }
}

export function ProjectProvider({ projects, children }: { projects: Project[]; children: React.ReactNode }) {
  const map = useMemo(() => {
    const m: ProjectMap = {};
    flattenProjects(projects, m);
    return m;
  }, [projects]);

  return <ProjectContext.Provider value={map}>{children}</ProjectContext.Provider>;
}

export function useProjectMap() {
  return useContext(ProjectContext);
}
