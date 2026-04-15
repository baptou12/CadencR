import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AgentSession, type AgentSessionHandle } from "@/components/agent-session";
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
  const featureSettings = useMemo(
    () => Object.fromEntries((featureSettingsData ?? []).map(s => [s.key, s.value])),
    [featureSettingsData],
  );
  const liveWorktreeBranch = useWsSessionStore((s) => s.sessions[sessionId]?.worktreeBranch);
  const gitBranch = liveWorktreeBranch ?? featureSettings.worktree_branch ?? branchData?.branch;

  const ws = useWebSocketSession(sessionId, featureId);
  const session = useWsSessionStore((s) => s.sessions[sessionId]);
  const [useWorktree, setUseWorktree] = useState(false);
  const initializedRef = useRef<string | null>(null);
  const { resolveModel, resolveProvider } = useResolvedModel(featureId, projectId);
  const resolvedProviderId = resolveProvider("session");
  const resolvedModelId = resolveModel("session");

  // Use worktree path as effective cwd once available (live WS → DB settings → project cwd)
  const effectiveCwd = session?.worktreePath ?? featureSettings.worktree_path ?? cwd;

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
  const retryWorktreeSetup = useWsSessionStore((s) => s.retryWorktreeSetup);
  const handleRetryWorktreeSetup = useCallback(() => retryWorktreeSetup(sessionId), [retryWorktreeSetup, sessionId]);

  const { isConnected, initSession } = ws;
  useEffect(() => {
    if (isConnected && initializedRef.current !== sessionId && session?.serverSessionId === "") {
      initializedRef.current = sessionId;
      initSession({ cwd, featureId, provider: resolvedProviderId, model: resolvedModelId });
    }
  }, [isConnected, initSession, cwd, featureId, sessionId, session?.serverSessionId, resolvedProviderId, resolvedModelId]);

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
    if (session?.serverSessionId && effectiveCwd) {
      requestSlashCommands(sessionId, effectiveCwd);
    }
  }, [session?.serverSessionId, effectiveCwd, sessionId, requestSlashCommands]);

  return (
    <div className="flex h-full flex-col">
      <FeatureTopBar
        featureId={featureId}
        projectId={projectId}
        mode="session"
        className="shrink-0"
        wsWorktreeStatus={session?.worktreeStatus}
        wsWorktreeBranch={session?.worktreeBranch}
        wsWorktreeSetupOutput={session?.worktreeSetupOutput}
        onRetryWorktreeSetup={handleRetryWorktreeSetup}
      />
      <FeatureTabBar activeTab={activeTab} featureId={featureId} onTabChange={handleTabChange} gitStats={gitStats} gitBranch={gitBranch} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <FeatureTerminalTab featureId={featureId} projectId={projectId} hidden={activeTab !== "terminal"} />

        {/* Editor tab — stays mounted to preserve state */}
        <div className={cn("h-full", activeTab !== "editor" && "hidden")}>
          {(effectiveCwd ?? projectPath) && (
            <Suspense fallback={null}>
              <FeatureEditorTab ref={editorTabRef} featureId={featureId} projectPath={(effectiveCwd ?? projectPath) as string} />
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
              // Pass useWorktree only on first prompt (blocks empty)
              const isFirstPrompt = (session?.blocks.length ?? 0) === 0;
              ws.sendPrompt(text, images, isFirstPrompt && useWorktree ? true : undefined);
            }}
            onStop={ws.interrupt}
            pendingPermission={ws.pendingPermission}
            onPermissionDecision={(decision, feedback) => {
              ws.respondToPermission(ws.pendingRequestId, decision, feedback);
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
            onPlanReject={() => {
              ws.requestPlanChanges("");
              ws.interrupt();
            }}
            contextUsage={ws.contextUsage}
            currentProviderId={ws.currentProviderId}
            onProviderChange={ws.setProvider}
            currentModelId={ws.currentModelId}
            onModelChange={ws.setModel}
            hasFileChanges={ws.hasFileChanges}
            onViewDiff={handleViewDiff}
            runtimeProvider={ws.runtimeProvider}
            runtimeSessionId={ws.runtimeSessionId || undefined}
            slashCommandsOverride={slashCommands}
            slashCommandsLoading={slashCommandsLoading}
            todos={session?.todos ?? null}
            hasMore={ws.hasMore}
            onLoadOlder={ws.loadOlderMessages}
            useWorktree={useWorktree}
            onToggleWorktree={() => setUseWorktree((v) => !v)}
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
