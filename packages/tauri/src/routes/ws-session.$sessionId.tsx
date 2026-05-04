import { createFileRoute } from "@tanstack/react-router";
import { WebSocketSessionFeatureBlock } from "@/components/WebSocketSessionFeatureBlock";

interface WsSessionSearch {
  cwd: string;
  featureId: number;
  projectId: number;
}

export const Route = createFileRoute("/ws-session/$sessionId")({
  component: WebSocketSessionPage,
  validateSearch: (search: Record<string, unknown>): WsSessionSearch => {
    if (typeof search.cwd !== "string" || !search.cwd) {
      throw new Error("cwd search param is required for WebSocket sessions");
    }
    const featureId = Number(search.featureId);
    const projectId = Number(search.projectId);
    if (!Number.isFinite(featureId) || featureId <= 0) {
      throw new Error("featureId search param is required for WebSocket sessions");
    }
    if (!Number.isFinite(projectId) || projectId <= 0) {
      throw new Error("projectId search param is required for WebSocket sessions");
    }
    return { cwd: search.cwd, featureId, projectId };
  },
});

function WebSocketSessionPage() {
  const { sessionId } = Route.useParams();
  const { cwd, featureId, projectId } = Route.useSearch();
  return (
    <WebSocketSessionFeatureBlock
      sessionId={sessionId}
      cwd={cwd}
      featureId={featureId}
      projectId={projectId}
    />
  );
}
