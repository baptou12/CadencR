import { useEffect, useRef } from "react";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { PlanInputView } from "@/components/PlanInputView";
import type { PlanInputImage } from "@/components/PlanInputView";

interface WsFeatureViewProps {
  featureId: number;
  projectId: number;
  feature: {
    id: number;
    title: string;
    status: string;
    type: string;
    project_id: number;
    created_at: string;
  };
}

export function WsFeatureView({
  featureId,
  projectId,
  feature,
}: WsFeatureViewProps) {
  const wsRef = useRef<WebSocket | null>(null);

  // Establish WebSocket connection and send workflow.feature.start
  useEffect(() => {
    const ws = new WebSocket("ws://localhost:5005/ws");
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          domain: "workflow",
          action: "feature.start",
          payload: { feature_id: featureId, project_id: projectId },
        }),
      );
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [featureId, projectId]);

  const handleStartPlanning = (_description: string, _images: PlanInputImage[]) => {
    // Coming soon — no-op for now
  };

  const handleStartPrd = (_description: string, _images: PlanInputImage[]) => {
    // Coming soon — no-op for now
  };

  return (
    <div className="flex h-full flex-col">
      <FeatureTopBar
        featureId={featureId}
        projectId={projectId}
        mode="feature"
        isWebSocket
        className="shrink-0"
      />
      <div className="flex flex-1 items-center justify-center p-8">
        <PlanInputView
          onStartPlanning={handleStartPlanning}
          onStartPrd={handleStartPrd}
          isStartingPlan={false}
          isStartingPrd={false}
        />
      </div>
    </div>
  );
}
