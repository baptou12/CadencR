import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AgentSession, type AgentSessionHandle } from "@/components/AgentSession";
import { DiffViewerModal } from "@/components/diff/DiffViewerModal";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { FeatureTabBar } from "@/components/FeatureTabBar";
import { FeatureTerminalTab } from "@/components/FeatureTerminalTab";
import { FeatureGitTab } from "@/components/FeatureGitTab";
import { useSaveLastOpenedFeature } from "@/hooks/useSaveLastOpenedFeature";
import { useWebSocketSession } from "@/hooks/useWebSocketSession";
import { useResolvedModel } from "@/hooks/useResolvedModel";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { useActiveTab } from "@/hooks/useActiveTab";
import { useGetStats, useGetBranch, useGetFeatureSettings, useListProjects } from "@/api/generated";
import { cn } from "@/lib/utils";
import type { FeatureEditorTabHandle } from "@/components/editor/FeatureEditorTab";

const FeatureEditorTab = lazy(() => import("@/components/editor/FeatureEditorTab"));

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

  const { activeTab, setActiveTab } = useActiveTab(featureId);
  useSaveLastOpenedFeature(projectId, featureId, activeTab);
  const editorTabRef = useRef<FeatureEditorTabHandle>(null);
  const projectsQuery = useListProjects();
  const projectPath = projectsQuery.data?.find((p) => p.id === projectId)?.path;
  const { data: gitStats } = useGetStats(
    { featureId, mode: "worktree" },
    { refetchInterval: 5 * 60 * 1000 },
  );
  const { data: branchData } = useGetBranch(
    { projectId },
    { refetchInterval: 10000 },
  );
  const { data: featureSettingsData } = useGetFeatureSettings(featureId);
  const worktreeBranch = featureSettingsData?.find(s => s.key === "worktree_branch")?.value;
  const gitBranch = worktreeBranch ?? branchData?.branch;

  const ws = useWebSocketSession(sessionId, featureId);
  const session = useWsSessionStore((s) => s.sessions[sessionId]);
  const initializedRef = useRef<string | null>(null);
  const { resolveModel } = useResolvedModel(featureId, projectId);
  const resolvedModelId = resolveModel("session");

  const handleTabChange = useCallback((tab: import("@/hooks/useActiveTab").FeatureTab) => {
    if (activeTab === "editor" && tab !== "editor" && editorTabRef.current) {
      editorTabRef.current.requestLeave(() => setActiveTab(tab));
    } else {
      setActiveTab(tab);
    }
  }, [activeTab, setActiveTab]);

  const agentSessionRef = useRef<AgentSessionHandle>(null);
  const [inlineDiffOpen, setInlineDiffOpen] = useState(false);
  const handleViewDiff = useCallback(() => setInlineDiffOpen(true), []);
  useHotkeys(
    "meta+g",
    (e) => {
      e.preventDefault();
      setInlineDiffOpen(true);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  const slashCommands = session?.slashCommands ?? [];
  const slashCommandsLoading = session?.slashCommandsLoading ?? false;
  const requestSlashCommands = useWsSessionStore((s) => s.requestSlashCommands);

  const { isConnected, initSession } = ws;
  useEffect(() => {
    if (isConnected && initializedRef.current !== sessionId && session?.serverSessionId === "") {
      initializedRef.current = sessionId;
      initSession({ cwd, featureId, model: resolvedModelId });
    }
  }, [isConnected, initSession, cwd, featureId, sessionId, session?.serverSessionId, resolvedModelId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      agentSessionRef.current?.focusPromptBar();
    });
  }, [sessionId]);

  useEffect(() => {
    const handler = () => agentSessionRef.current?.focusPromptBar();
    window.addEventListener("cadence:focus-prompt", handler);
    return () => window.removeEventListener("cadence:focus-prompt", handler);
  }, []);

  useEffect(() => {
    if (session?.serverSessionId && cwd) {
      requestSlashCommands(sessionId, cwd);
    }
  }, [session?.serverSessionId, cwd, sessionId, requestSlashCommands]);

  return (
    <div className="flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} mode="session" className="shrink-0" />
      <FeatureTabBar activeTab={activeTab} featureId={featureId} onTabChange={handleTabChange} gitStats={gitStats} gitBranch={gitBranch} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <FeatureTerminalTab featureId={featureId} projectId={projectId} hidden={activeTab !== "terminal"} />

        {/* Editor tab — stays mounted to preserve state */}
        <div className={cn("h-full", activeTab !== "editor" && "hidden")}>
          {projectPath && (
            <Suspense fallback={null}>
              <FeatureEditorTab ref={editorTabRef} featureId={featureId} projectPath={projectPath} />
            </Suspense>
          )}
        </div>

        {activeTab === "git" && (
          <FeatureGitTab featureId={featureId} diffMode="worktree" />
        )}

        <div className={cn("h-full", activeTab !== "agent" && "hidden")}>
          <AgentSession
            ref={agentSessionRef}
            agentType="session"
            featureId={featureId}
            projectId={projectId}
            wsSessionId={sessionId}
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
            hasMore={ws.hasMore}
            onLoadOlder={ws.loadOlderMessages}
            className="h-full"
          />
        </div>
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
