import { ReactFlowProvider } from "@xyflow/react";
import type { ReactNode } from "react";

export function FlowProvider({ children }: { children: ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}
