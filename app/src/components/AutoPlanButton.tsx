import { useState } from "react";
import { autoPlan, taskNeedsPlan } from "../utils/generatePlan";
import type { Task, Project } from "../types";

const AutoPlanIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v4" />
    <path d="M12 18v4" />
    <path d="m4.93 4.93 2.83 2.83" />
    <path d="m16.24 16.24 2.83 2.83" />
    <path d="M2 12h4" />
    <path d="M18 12h4" />
    <path d="m4.93 19.07 2.83-2.83" />
    <path d="m16.24 7.76 2.83-2.83" />
  </svg>
);

const SpinnerIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4m-3.93 7.07l-2.83-2.83M7.76 7.76L4.93 4.93" />
  </svg>
);

interface Props {
  task: Task;
  project?: Pick<Project, "name" | "notes"> | null;
  onDone: () => void;
  iconSize?: number;
}

export default function AutoPlanButton({ task, project, onDone, iconSize = 14 }: Props) {
  const [generating, setGenerating] = useState(false);

  const needsPlan = taskNeedsPlan(task);

  const handleClick = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const result = await autoPlan(task, project);
      if (result.count > 0) {
        onDone();
      }
    } catch (err: any) {
      console.error("Auto-plan failed:", err);
      alert("Auto-plan failed: " + (err.message || err));
    } finally {
      setGenerating(false);
    }
  };

  if (!needsPlan) return null;

  return (
    <button
      className={`secondary ${generating ? "generating" : ""}`}
      disabled={generating}
      onClick={handleClick}
      title="Auto-generate subtasks plan before coding"
      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
    >
      {generating ? <SpinnerIcon size={iconSize} /> : <AutoPlanIcon size={iconSize} />}
      {generating ? "Auto-planning..." : "Auto Plan"}
    </button>
  );
}
