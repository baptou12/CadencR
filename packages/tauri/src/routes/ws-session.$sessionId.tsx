import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AgentSession, type AgentSessionHandle } from "@/components/AgentSession";
import { DiffViewerModal } from "@/components/diff/DiffViewerModal";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { useSaveLastOpenedFeature } from "@/hooks/useSaveLastOpenedFeature";
import { useWebSocketSession } from "@/hooks/useWebSocketSession";
import { useResolvedModel } from "@/hooks/useResolvedModel";
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

  useSaveLastOpenedFeature(projectId, featureId);

  const ws = useWebSocketSession(sessionId, featureId);
  const session = useWsSessionStore((s) => s.sessions[sessionId]);
  const initializedRef = useRef<string | null>(null);
  const { resolveModel } = useResolvedModel(featureId, projectId);
  const resolvedModelId = resolveModel("session");

  const agentSessionRef = useRef<AgentSessionHandle>(null);
  const [inlineDiffOpen, setInlineDiffOpen] = useState(false);
  const handleViewDiff = useCallback(() => setInlineDiffOpen(true), []);
  useHotkeys(
    "meta+d",
    (e) => {
      e.preventDefault();
      setInlineDiffOpen(true);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // Slash commands from ws-session store
  const slashCommands = session?.slashCommands ?? [];
  const slashCommandsLoading = session?.slashCommandsLoading ?? false;
  const requestSlashCommands = useWsSessionStore((s) => s.requestSlashCommands);

  // Auto-init session once connected — only once per sessionId
  const { isConnected, initSession } = ws;
  useEffect(() => {
    if (isConnected && initializedRef.current !== sessionId && session?.serverSessionId === "") {
      initializedRef.current = sessionId;
      initSession({ cwd, featureId, model: resolvedModelId });
    }
  }, [isConnected, initSession, cwd, featureId, sessionId, session?.serverSessionId, resolvedModelId]);

  // Auto-focus prompt bar when session page mounts
  useEffect(() => {
    requestAnimationFrame(() => {
      agentSessionRef.current?.focusPromptBar();
    });
  }, []);

  // Request slash commands once the session is initialized
  useEffect(() => {
    if (session?.serverSessionId && cwd) {
      requestSlashCommands(sessionId, cwd);
    }
  }, [session?.serverSessionId, cwd, sessionId, requestSlashCommands]);

  return (
    <div className="flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} mode="session" isWebSocket className="shrink-0" />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AgentSession
          ref={agentSessionRef}
          agentType="session"
          featureId={featureId}
          projectId={projectId}
          blocks={ws.blocks}
          status={ws.status}
          onSend={(text, images) => {
            if (text.trim() === "/clear") {
              ws.clearSession();
              return;
            }
            ws.sendPrompt(text, images);
          }}
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
          hasFileChanges={ws.hasFileChanges}
          onViewDiff={handleViewDiff}
          claudeSessionId={ws.claudeSessionId || undefined}
          slashCommandsOverride={slashCommands}
          slashCommandsLoading={slashCommandsLoading}
          todos={session?.todos ?? null}
          className="h-full"
        />
      </div>
      <DiffViewerModal
        featureId={featureId}
        open={inlineDiffOpen}
        onOpenChange={setInlineDiffOpen}
        hideFooter
      />
    </div>
  );
}
