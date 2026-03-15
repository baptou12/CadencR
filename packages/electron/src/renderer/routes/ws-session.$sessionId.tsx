import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { AgentSession } from "@/components/AgentSession";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { useWebSocketSession } from "@/hooks/useWebSocketSession";

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
  const ws = useWebSocketSession(sessionId, featureId);
  const initializedRef = useRef(false);

  // Auto-init session on mount once connected
  const { isConnected, initSession } = ws;
  useEffect(() => {
    if (isConnected && !initializedRef.current) {
      initializedRef.current = true;
      initSession({ cwd, featureId });
    }
  }, [isConnected, initSession, cwd]);

  return (
    <div className="flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} mode="session" isWebSocket className="shrink-0" />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AgentSession
          agentType="session"
          blocks={ws.blocks}
          status={ws.status}
          onSend={ws.sendPrompt}
          onStop={ws.interrupt}
          pendingPermission={ws.pendingPermission}
          onPermissionDecision={(decision) => {
            ws.respondToPermission(ws.pendingRequestId, decision !== "deny");
          }}
          pendingQuestions={ws.pendingQuestions.length > 0 ? ws.pendingQuestions : undefined}
          onAnswerSubmit={ws.respondToQuestion}
          permissionMode={ws.permissionMode}
          onPermissionModeToggle={() => {
            const next = ws.permissionMode === "plan" ? "acceptEdits" : "plan";
            ws.setPermissionMode(next);
          }}
          pendingPlanApproval={ws.pendingPlanApproval}
          onPlanApprove={ws.approvePlan}
          onPlanRequestChanges={ws.requestPlanChanges}
          currentModelId={ws.currentModelId}
          onModelChange={ws.setModel}
          className="h-full"
        />
      </div>
    </div>
  );
}
