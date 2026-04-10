import { useState } from "react";
import { launchGoAi } from "../utils/goai";
import { api } from "../api/client";
import { useProjectMap } from "../contexts/ProjectContext";
import type { Task } from "../types";
import PlanFirstFlow from "./PlanFirstFlow";

interface Props {
  task: Task;
  /** Called when the flow completes (plan confirmed + GoAi launched) */
  onDone: () => void;
  /** Called when the user cancels the flow. Falls back to onDone if not provided. */
  onCancel?: () => void;
  /** If true, starts the flow immediately on mount */
  autoStart?: boolean;
}

/**
 * GoAiPlanFlow: Plan-first workflow for GoAi.
 *
 * Composes PlanFirstFlow (plan generation/preview/confirmation) with GoAi launch.
 * Sets status to "goai" and launches GoAi after the plan is confirmed.
 */
export default function GoAiPlanFlow({ task, onDone, onCancel, autoStart = true }: Props) {
  const projectMap = useProjectMap();
  const [launching, setLaunching] = useState(false);

  const handlePlanDone = async (updatedTask: Task) => {
    setLaunching(true);
    try {
      await api.updateTask(updatedTask.id, { status: "goai" });
      await launchGoAi(updatedTask, projectMap);
    } catch (err) {
      console.error("GoAiPlanFlow: Failed to launch:", err);
    }
    setLaunching(false);
    onDone();
  };

  const handleCancel = () => {
    (onCancel || onDone)();
  };

  if (launching) {
    return (
      <div className="plan-preview-overlay">
        <div className="goai-plan-loading">
          <div className="goai-plan-spinner" />
          <span>Launching GoAi...</span>
        </div>
      </div>
    );
  }

  return (
    <PlanFirstFlow
      task={task}
      onDone={handlePlanDone}
      onCancel={handleCancel}
      autoStart={autoStart}
    />
  );
}
