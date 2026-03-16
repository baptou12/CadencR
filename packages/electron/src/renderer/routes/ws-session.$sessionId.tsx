import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { AgentSession } from "@/components/AgentSession";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { useWebSocketSession } from "@/hooks/useWebSocketSession";
import { useWsSessionStore } from "@/stores/ws-session-store";

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
  const session = useWsSessionStore((s) => s.sessions[sessionId]);
  const initializedRef = useRef<string | null>(null);

  // Auto-init session once connected — only once per sessionId
  const { isConnected, initSession } = ws;
  useEffect(() => {
    if (isConnected && initializedRef.current !== sessionId && session?.serverSessionId === "") {
      initializedRef.current = sessionId;
      initSession({ cwd, featureId });
    }
  }, [isConnected, initSession, cwd, featureId, sessionId, session?.serverSessionId]);

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
          contextUsage={ws.contextUsage}
          currentModelId={ws.currentModelId}
          onModelChange={ws.setModel}
          claudeSessionId={ws.claudeSessionId || undefined}
          className="h-full"
        />
      </div>
    </div>
  );
}
