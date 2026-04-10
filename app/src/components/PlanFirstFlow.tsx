import { useState, useEffect } from "react";
import { generatePlanPreview, confirmPlanSubtasks, taskNeedsPlan } from "../utils/generatePlan";
import { useProjectMap } from "../contexts/ProjectContext";
import { api } from "../api/client";
import type { SubtaskProposal } from "../api/client";
import type { Task } from "../types";
import PlanPreview from "./PlanPreview";

type FlowState =
  | { step: "idle" }
  | { step: "generating" }
  | { step: "preview"; proposals: SubtaskProposal[] }
  | { step: "confirming" };

interface Props {
  task: Task;
  /** Called when the flow completes (plan confirmed) with the updated task */
  onDone: (updatedTask: Task) => void;
  /** Called when the user cancels the flow */
  onCancel: () => void;
  /** If true, starts the flow immediately on mount */
  autoStart?: boolean;
}

/**
 * PlanFirstFlow: Reusable plan-first workflow.
 *
 * Generates a plan (subtasks) via AI, shows a preview modal for the user
 * to review/edit, and calls onDone with the updated task after confirmation.
 * Skips if the task already has active subtasks or is a subtask itself.
 */
export default function PlanFirstFlow({ task, onDone, onCancel, autoStart = true }: Props) {
  const projectMap = useProjectMap();
  const project = task.project_id ? projectMap[task.project_id] : null;
  const [state, setState] = useState<FlowState>({ step: "idle" });

  useEffect(() => {
    if (!autoStart) return;
    startFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startFlow = async () => {
    // Skip for subtasks (no plan for child tasks)
    if (task.parent_task_id != null) {
      onDone(task);
      return;
    }

    // Skip if task already has active subtasks
    if (!taskNeedsPlan(task)) {
      onDone(task);
      return;
    }

    // Generate plan preview
    setState({ step: "generating" });
    try {
      const proposals = await generatePlanPreview(task, project);
      if (proposals.length === 0) {
        // No proposals generated, continue without plan
        onDone(task);
        return;
      }
      setState({ step: "preview", proposals });
    } catch (err: any) {
      console.error("PlanFirstFlow: Failed to generate plan:", err);
      const shouldContinue = confirm(
        "Plan generation failed. Continue without a plan?\n\n" + (err.message || err)
      );
      if (shouldContinue) {
        onDone(task);
      } else {
        setState({ step: "idle" });
        onCancel();
      }
    }
  };

  const handleConfirm = async (subtasks: SubtaskProposal[]) => {
    setState({ step: "confirming" });
    try {
      await confirmPlanSubtasks(task.id, subtasks);
      // Re-fetch task with new subtasks
      const updated = await api.getTask(task.id);
      onDone(updated);
    } catch (err: any) {
      console.error("PlanFirstFlow: Failed to confirm plan:", err);
      alert("Failed to create subtasks: " + (err.message || err));
      setState({ step: "idle" });
      onCancel();
    }
  };

  const handleCancel = () => {
    setState({ step: "idle" });
    onCancel();
  };

  // Overlay for generating/confirming states
  if (state.step === "generating" || state.step === "confirming") {
    return (
      <div className="plan-preview-overlay">
        <div className="goai-plan-loading">
          <div className="goai-plan-spinner" />
          <span>
            {state.step === "generating" && "Generating plan..."}
            {state.step === "confirming" && "Creating subtasks..."}
          </span>
        </div>
      </div>
    );
  }

  // Plan preview modal
  if (state.step === "preview") {
    return (
      <PlanPreview
        proposals={state.proposals}
        parentTitle={task.title}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        confirming={false}
      />
    );
  }

  return null;
}
