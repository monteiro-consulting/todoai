import { useEffect, useCallback, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  MarkerType,
  Panel,
  Handle,
  Position,
} from "@xyflow/react";
import Dagre from "@dagrejs/dagre";
import { api } from "../api/client";
import { useNavigate } from "react-router-dom";

/* ---------- status helpers ---------- */

const STATUS_COLORS: Record<string, string> = {
  open: "var(--text-muted)",
  waiting: "var(--yellow)",
  in_progress: "var(--accent)",
  goai: "var(--accent-hover)",
  done: "var(--green)",
  archived: "var(--border)",
};

const STATUS_LABELS: Record<string, string> = {
  open: "To Do",
  waiting: "Waiting",
  in_progress: "In Progress",
  goai: "GoAi",
  done: "Done",
  archived: "Archived",
};

/* ---------- custom task node ---------- */

type TaskNodeData = {
  label: string;
  status: string;
  impact: number;
  effort: number;
  due_at: string | null;
};

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `${Math.abs(diffDays)}d late`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 7) return `${diffDays}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TaskNode({ data }: NodeProps<Node<TaskNodeData>>) {
  const color = STATUS_COLORS[data.status] || "var(--text-muted)";
  const isDone = data.status === "done" || data.status === "archived";
  const isLate = data.due_at && new Date(data.due_at) < new Date() && !isDone;

  return (
    <div
      className={`dep-graph-node ${isDone ? "dep-graph-node--done" : ""}`}
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="dep-graph-node-header">
        <div className="dep-graph-node-title">{data.label}</div>
        <div className="dep-graph-node-status" style={{ backgroundColor: color }} />
      </div>
      <div className="dep-graph-node-meta">
        <span className="dep-graph-node-badge" style={{ color }}>
          {STATUS_LABELS[data.status] || data.status}
        </span>
        <span className="dep-graph-node-pills">
          <span className="dep-graph-node-pill" title="Impact">▲{data.impact}</span>
          <span className="dep-graph-node-pill" title="Effort">✦{data.effort}</span>
        </span>
      </div>
      {data.due_at && (
        <div className={`dep-graph-node-due ${isLate ? "dep-graph-node-due--late" : ""}`}>
          {formatDueDate(data.due_at)}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes: NodeTypes = { task: TaskNode };

/* ---------- dagre layout ---------- */

const NODE_WIDTH = 220;
const NODE_HEIGHT = 90;

function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
): { nodes: Node[]; edges: Edge[] } {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  Dagre.layout(g);

  const laidOut = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: laidOut, edges };
}

/* ---------- main component ---------- */

interface Props {
  projectId?: string;
}

export default function DependencyGraph({ projectId }: Props) {
  const navigate = useNavigate();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<"TB" | "LR">("TB");

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDependencyGraph(projectId);

      if (data.nodes.length === 0) {
        setNodes([]);
        setEdges([]);
        setLoading(false);
        return;
      }

      // Build a lookup for node status to color edges
      const statusMap = new Map(data.nodes.map((n) => [n.id, n.status]));

      const rawNodes: Node[] = data.nodes.map((n) => ({
        id: n.id,
        type: "task",
        position: { x: 0, y: 0 },
        data: {
          label: n.title,
          status: n.status,
          impact: n.impact,
          effort: n.effort,
          due_at: n.due_at,
        },
      }));

      const rawEdges: Edge[] = data.edges.map((e, i) => {
        // Edge color logic: trigger edges keep accent,
        // dependency edges colored by source status
        let stroke = "var(--border)";
        let label: string | undefined;
        let animated = false;

        if (e.type === "trigger") {
          stroke = "var(--accent)";
          label = "trigger";
          animated = true;
        } else {
          const sourceStatus = statusMap.get(e.source);
          const targetStatus = statusMap.get(e.target);
          if (sourceStatus === "done") {
            // Prerequisite completed → green
            stroke = "var(--green)";
          } else if (
            targetStatus === "waiting" ||
            (targetStatus === "open" && sourceStatus !== "done")
          ) {
            // Target is blocked → red
            stroke = "var(--red)";
          }
        }

        return {
          id: `e-${i}`,
          source: e.source,
          target: e.target,
          type: "smoothstep",
          animated,
          style: { stroke, strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
          },
          label,
          labelStyle: { fill: "var(--text-muted)", fontSize: 10 },
        };
      });

      const laid = layoutGraph(rawNodes, rawEdges, direction);
      setNodes(laid.nodes);
      setEdges(laid.edges);
    } catch (err: any) {
      setError(err.message || "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, [projectId, direction]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      navigate(`/task/${node.id}`);
    },
    [navigate],
  );

  if (loading) {
    return <div className="empty-state">Loading graph...</div>;
  }

  if (error) {
    return <div className="empty-state">Error: {error}</div>;
  }

  if (nodes.length === 0) {
    return <div className="empty-state">No dependencies to display</div>;
  }

  return (
    <div className="dep-graph-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => STATUS_COLORS[(n.data as TaskNodeData)?.status] || "#888"}
          pannable
          zoomable
        />
        <Panel position="top-right" className="dep-graph-panel">
          <button
            className={`secondary ${direction === "TB" ? "active" : ""}`}
            onClick={() => setDirection("TB")}
            title="Top to Bottom"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          </button>
          <button
            className={`secondary ${direction === "LR" ? "active" : ""}`}
            onClick={() => setDirection("LR")}
            title="Left to Right"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
