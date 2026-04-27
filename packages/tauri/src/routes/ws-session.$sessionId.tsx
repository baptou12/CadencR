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
import { useAgentCatalog } from "@/api/agentRuntime";
import { useWebSocketSession } from "@/hooks/useWebSocketSession";
import { useResolvedModel } from "@/hooks/useResolvedModel";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { useActiveTab } from "@/hooks/useActiveTab";
import { useGetStats, useGetBranch, useGetFeatureSettings, useListProjects } from "@/api/generated";
import { nextThinkingEffort, supportedThinkingEffortLevels } from "@/shared/thinking-effort";
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
    { feature_id: featureId, mode: "worktree" },
    { query: { refetchInterval: 5 * 60 * 1000 } },
  );
  const { data: branchData } = useGetBranch(
    { project_id: projectId },
    { query: { refetchInterval: 10000 } },
  );
  const { data: featureSettingsData } = useGetFeatureSettings(featureId);
  const featureSettings = useMemo(
    () => Object.fromEntries((featureSettingsData ?? []).map((s) => [s.key, s.value])),
    [featureSettingsData],
  );
  const liveWorktreeBranch = useWsSessionStore((s) => s.sessions[sessionId]?.worktreeBranch);
  const gitBranch = liveWorktreeBranch ?? featureSettings.worktree_branch ?? branchData?.branch;

  const ws = useWebSocketSession(sessionId, featureId);
  const session = useWsSessionStore((s) => s.sessions[sessionId]);
  const [useWorktree, setUseWorktree] = useState(false);
  const initializedRef = useRef<string | null>(null);
  const { resolveModel, resolveProvider, resolveModelThinkingEffort } = useResolvedModel(
    featureId,
    projectId,
  );
  const agentCatalog = useAgentCatalog();
  const resolvedProviderId = resolveProvider("session");
  const resolvedModelId = resolveModel("session");
  // Per-model default for the picked session model. The backend persists the
  // conversation's own override on `agent_sessions.thinking_effort` and only
  // falls back to this default when the row hasn't been ancored yet.
  const resolvedThinkingEffort = resolveModelThinkingEffort(resolvedProviderId, resolvedModelId);
  const activeSessionModel = agentCatalog.data?.providers
    .find((provider) => provider.id === (ws.currentProviderId || resolvedProviderId))
    ?.models.find((model) => model.id === (ws.currentModelId || resolvedModelId));
  const supportedThinkingEfforts = supportedThinkingEffortLevels(activeSessionModel);
  const activeProviderId = ws.runtimeProvider || ws.currentProviderId || resolvedProviderId;

  // Use worktree path as effective cwd once available (live WS → DB settings → project cwd)
  const effectiveCwd = session?.worktreePath ?? featureSettings.worktree_path ?? cwd;

  const handleTabChange = useCallback(
    (tab: import("@/hooks/useActiveTab").FeatureTab) => {
      if (activeTab === "editor" && tab !== "editor" && editorTabRef.current) {
        editorTabRef.current.requestLeave(() => setActiveTab(tab));
      } else {
        setActiveTab(tab);
      }
    },
    [activeTab, setActiveTab],
  );

  const agentSessionRef = useRef<AgentSessionHandle>(null);
  const [inlineDiffOpen, setInlineDiffOpen] = useState(false);
  const handleViewDiff = useCallback(() => setInlineDiffOpen(true), []);

  const sendPromptAndFocus = useCallback(
    (message: string) => {
      ws.sendPrompt(message);
      requestAnimationFrame(() => agentSessionRef.current?.focusPromptBar());
    },
    [ws],
  );
  const sendFromGitTab = useCallback(
    (message: string) => {
      sendPromptAndFocus(message);
      setActiveTab("agent");
    },
    [sendPromptAndFocus, setActiveTab],
  );
  useHotkeys(
    "meta+g",
    (e) => {
      e.preventDefault();
      setInlineDiffOpen(true);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );
  useHotkeys(
    "meta+t",
    (e) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.closest("[data-agent-prompt-bar='true']"))
        return;
      if (supportedThinkingEfforts.length === 0) return;
      e.preventDefault();
      const next = nextThinkingEffort(supportedThinkingEfforts, ws.currentThinkingEffort);
      if (!next) return;
      ws.setThinkingEffort(next);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  const slashCommands = session?.slashCommands ?? [];
  const slashCommandsLoading = session?.slashCommandsLoading ?? false;
  const requestSlashCommands = useWsSessionStore((s) => s.requestSlashCommands);
  const retryWorktreeSetup = useWsSessionStore((s) => s.retryWorktreeSetup);
  const handleRetryWorktreeSetup = useCallback(
    () => retryWorktreeSetup(sessionId),
    [retryWorktreeSetup, sessionId],
  );

  const { isConnected, initSession } = ws;
  useEffect(() => {
    if (isConnected && initializedRef.current !== sessionId && session?.serverSessionId === "") {
      initializedRef.current = sessionId;
      initSession({
        cwd,
        featureId,
        provider: resolvedProviderId,
        model: resolvedModelId,
        thinkingEffort: resolvedThinkingEffort,
      });
    }
  }, [
    isConnected,
    initSession,
    cwd,
    featureId,
    sessionId,
    session?.serverSessionId,
    resolvedProviderId,
    resolvedModelId,
    resolvedThinkingEffort,
  ]);

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
      requestSlashCommands(sessionId, effectiveCwd, activeProviderId);
    }
  }, [session?.serverSessionId, effectiveCwd, sessionId, requestSlashCommands, activeProviderId]);

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
      <FeatureTabBar
        activeTab={activeTab}
        featureId={featureId}
        onTabChange={handleTabChange}
        gitStats={gitStats}
        gitBranch={gitBranch}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <FeatureTerminalTab
          featureId={featureId}
          projectId={projectId}
          hidden={activeTab !== "terminal"}
        />

        {/* Editor tab — stays mounted to preserve state */}
        <div className={cn("h-full", activeTab !== "editor" && "hidden")}>
          {(effectiveCwd ?? projectPath) && (
            <Suspense fallback={null}>
              <FeatureEditorTab
                ref={editorTabRef}
                featureId={featureId}
                projectId={projectId}
                projectPath={(effectiveCwd ?? projectPath) as string}
              />
            </Suspense>
          )}
        </div>

        {activeTab === "git" && (
          <FeatureGitTab
            featureId={featureId}
            diffMode="worktree"
            onSendComments={sendFromGitTab}
          />
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
              if (text.trim() === "/compact" && activeProviderId === "opencode") {
                ws.compactSession();
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
            onModelChange={(nextProviderId, modelId) => {
              // Avoid sending a redundant WS frame when the user re-picks the
              // same model (the picker still fires onSelect on identical
              // selections). Effort resolution below still runs so a stale
              // effort can recover on a same-model re-pick.
              if (modelId !== ws.currentModelId) {
                ws.setModel(modelId);
              }
              const nextModel = agentCatalog.data?.providers
                .find((provider) => provider.id === nextProviderId)
                ?.models.find((model) => model.id === modelId);
              const nextLevels = supportedThinkingEffortLevels(nextModel);
              // Pull the last-used effort for the model the user just switched
              // to. We trust the providerId from the picker rather than
              // `ws.currentProviderId` — the WS store hasn't yet acknowledged
              // a sibling `setProvider` call, so reading it here would yield
              // the *previous* provider and miss the per-model default.
              const nextEffort = resolveModelThinkingEffort(nextProviderId, modelId);
              if (nextEffort) {
                ws.setThinkingEffort(nextEffort);
              } else if (!nextLevels.includes(ws.currentThinkingEffort as never)) {
                ws.setThinkingEffort(undefined);
              }
            }}
            currentThinkingEffort={ws.currentThinkingEffort}
            onThinkingEffortChange={ws.setThinkingEffort}
            hasFileChanges={ws.hasFileChanges}
            onViewDiff={handleViewDiff}
            runtimeProvider={ws.runtimeProvider}
            runtimeSessionId={ws.runtimeSessionId || undefined}
            slashCommandsOverride={slashCommands}
            slashCommandsLoading={slashCommandsLoading}
            // Only feed todos when the agent pane is visible — the popover is
            // portaled to document.body so it would otherwise pop over hidden tabs.
            todos={activeTab === "agent" ? (session?.todos ?? null) : null}
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
        onSendComments={sendPromptAndFocus}
      />
    </div>
  );
}
