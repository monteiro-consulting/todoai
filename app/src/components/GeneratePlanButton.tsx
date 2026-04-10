import { useState } from "react";
import { generatePlanPreview, confirmPlanSubtasks } from "../utils/generatePlan";
import type { SubtaskProposal } from "../api/client";
import type { Task, Project } from "../types";
import PlanPreview from "./PlanPreview";

const PlanIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
    <rect x="9" y="3" width="6" height="4" rx="1" />
    <path d="M9 12h6" />
    <path d="M9 16h6" />
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

export default function GeneratePlanButton({ task, project, onDone, iconSize = 14 }: Props) {
  const [generating, setGenerating] = useState(false);
  const [proposals, setProposals] = useState<SubtaskProposal[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  const handleClick = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const result = await generatePlanPreview(task, project);
      setProposals(result);
    } catch (err: any) {
      console.error("Failed to generate plan preview:", err);
      alert("Plan generation failed: " + (err.message || err));
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirm = async (subtasks: SubtaskProposal[]) => {
    setConfirming(true);
    try {
      const count = await confirmPlanSubtasks(task.id, subtasks);
      setProposals(null);
      if (count > 0) onDone();
    } catch (err: any) {
      console.error("Failed to confirm plan:", err);
      alert("Failed to create subtasks: " + (err.message || err));
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = () => {
    setProposals(null);
  };

  return (
    <>
      <button
        className={`secondary ${generating ? "generating" : ""}`}
        disabled={generating}
        onClick={handleClick}
        title="Generate subtasks plan using AI"
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
      >
        {generating ? <SpinnerIcon size={iconSize} /> : <PlanIcon size={iconSize} />}
        {generating ? "Planning..." : "Plan"}
      </button>

      {proposals && (
        <PlanPreview
          proposals={proposals}
          parentTitle={task.title}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          confirming={confirming}
        />
      )}
    </>
  );
}
