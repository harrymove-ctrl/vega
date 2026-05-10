"use client";

import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const initialNodes = [
  {
    id: "trigger",
    position: { x: 40, y: 80 },
    data: { label: "Trigger\nETF inflow > $X" },
    style: {
      background: "rgba(220,232,93,0.06)",
      border: "1px solid rgba(220,232,93,0.4)",
      color: "#fafafa",
      borderRadius: 12,
      padding: 12,
      fontSize: 12,
      whiteSpace: "pre-line" as const,
    },
  },
  {
    id: "filter",
    position: { x: 280, y: 80 },
    data: { label: "Filter\nSentiment > 0.6" },
    style: {
      background: "rgba(96,165,250,0.06)",
      border: "1px solid rgba(96,165,250,0.4)",
      color: "#fafafa",
      borderRadius: 12,
      padding: 12,
      fontSize: 12,
      whiteSpace: "pre-line" as const,
    },
  },
  {
    id: "action",
    position: { x: 520, y: 80 },
    data: { label: "Action\nSoDEX market buy" },
    style: {
      background: "rgba(116,185,127,0.06)",
      border: "1px solid rgba(116,185,127,0.4)",
      color: "#fafafa",
      borderRadius: 12,
      padding: 12,
      fontSize: 12,
      whiteSpace: "pre-line" as const,
    },
  },
];

const initialEdges = [
  { id: "e1", source: "trigger", target: "filter", animated: true },
  { id: "e2", source: "filter", target: "action", animated: true },
];

export function BuilderCanvas() {
  return (
    <div className="h-[640px] overflow-hidden rounded-xl border border-default bg-card-deep">
      <ReactFlow
        nodes={initialNodes}
        edges={initialEdges}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} color="rgba(255,255,255,0.04)" />
        <MiniMap
          pannable
          zoomable
          style={{ background: "#16181a" }}
          maskColor="rgba(0,0,0,0.6)"
          nodeColor={() => "#dce85d"}
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}
