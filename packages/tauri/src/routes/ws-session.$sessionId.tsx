import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { BotIcon, CodeIcon, GitCompareArrowsIcon, TerminalIcon } from "lucide-react";
import { AgentSession, type AgentSessionHandle } from "@/components/agent-session";
import { DiffViewerModal } from "@/components/diff/DiffViewerModal";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { FeatureTerminalTab, type FeatureTerminalTabHandle } from "@/components/FeatureTerminalTab";
import { FeatureGitTab } from "@/components/FeatureGitTab";
import { FeatureLayoutShell } from "@/components/feature-layout/FeatureLayoutShell";
import { GitBadge } from "@/components/feature-layout/GitBadge";
import type { FeatureTabs } from "@/components/feature-layout/types";
import { useSaveLastOpenedFeature } from "@/hooks/useSaveLastOpenedFeature";
import { useAgentLetterFocus } from "@/hooks/useAgentLetterFocus";
import { useAgentCatalog } from "@/api/agentRuntime";
import { useWebSocketSession } from "@/hooks/useWebSocketSession";
import { useResolvedModel } from "@/hooks/useResolvedModel";
import { useWsSessionStore } from "@/stores/ws-session-store";
import {
  useFeatureLayoutStore,
  selectFeatureLayout,
  findLeafById,
  isTabVisible,
} from "@/stores/feature-layout-store";
import { ROOT_LEAF_ID } from "@/stores/feature-layout-schema";
import { useGetStats, useGetBranch, useGetFeatureSettings, useListProjects } from "@/api/generated";
import { nextThinkingEffort, supportedThinkingEffortLevels } from "@/shared/thinking-effort";
import type { FeatureEditorTabHandle } from "@/components/editor/FeatureEditorTab";

const FeatureEditorTab = lazy(() => import("@/components/editor/FeatureEditorTab"));

// Claude Code handles `/compact` as a native slash prompt. OpenCode and Codex
// expose compaction through Cadence's session.compact action.
const COMPACT_ACTION_PROVIDERS = new Set(["opencode", "codex_cli"]);

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

  const layoutState = useFeatureLayoutStore(selectFeatureLayout(featureId));
  const rootLeaf = findLeafById(layoutState.splitRoot, ROOT_LEAF_ID);
  const rootActiveTabId = rootLeaf?.activeTabId ?? "agent";
  useSaveLastOpenedFeature(projectId, featureId, rootActiveTabId);
  const editorTabRef = useRef<FeatureEditorTabHandle>(null);
  const terminalTabRef = useRef<FeatureTerminalTabHandle>(null);
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

  const setPaneActiveTab = useFeatureLayoutStore((s) => s.setPaneActiveTab);
  const setRootActive = useCallback(
    (tab: import("@/stores/feature-layout-schema").TabKind) => {
      setPaneActiveTab(featureId, ROOT_LEAF_ID, tab);
    },
    [featureId, setPaneActiveTab],
  );

  const agentSessionRef = useRef<AgentSessionHandle>(null);
  const focusedLeaf = layoutState.focusedPaneId
    ? findLeafById(layoutState.splitRoot, layoutState.focusedPaneId)
    : null;
  const focusAgentFromLetter = useCallback((): void => {
    agentSessionRef.current?.focusActiveInput();
  }, []);
  useAgentLetterFocus({
    enabled: focusedLeaf ? focusedLeaf.activeTabId === "agent" : rootActiveTabId === "agent",
    onFocus: focusAgentFromLetter,
  });
  const [inlineDiffOpen, setInlineDiffOpen] = useState(false);
  const handleViewDiff = useCallback(() => setInlineDiffOpen(true), []);
  const handleTerminalActivate = useCallback((): void => {
    requestAnimationFrame(() => terminalTabRef.current?.activate());
  }, []);
  const handleEditorActivate = useCallback((): void => {
    requestAnimationFrame(() => editorTabRef.current?.focusActiveEditor());
  }, []);

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
      setRootActive("agent");
    },
    [sendPromptAndFocus, setRootActive],
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
    window.addEventListener("cadencr:focus-prompt", handler);
    return () => window.removeEventListener("cadencr:focus-prompt", handler);
  }, []);

  useEffect(() => {
    if (session?.serverSessionId && effectiveCwd) {
      requestSlashCommands(sessionId, effectiveCwd, activeProviderId);
    }
  }, [session?.serverSessionId, effectiveCwd, sessionId, requestSlashCommands, activeProviderId]);

  const agentVisible = isTabVisible(layoutState, "agent");
  const projectPathOrCwd = effectiveCwd ?? projectPath;

  // Per-tab memos with narrow deps so chunk-driven re-renders of the agent
  // tab do not invalidate the terminal/git/editor tabs (and vice versa). The
  // agent tab still rebuilds whenever `ws` changes (i.e. on every chunk),
  // which is unavoidable: it consumes most of `ws`. The other three tabs are
  // immune.
  const agentTab = useMemo(
    () => ({
      label: "Agent",
      Icon: BotIcon,
      shortcut: ["cmd", "shift", "A"],
      content: (
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
            if (text.trim() === "/compact" && COMPACT_ACTION_PROVIDERS.has(activeProviderId)) {
              ws.compactSession();
              return;
            }
            const isFirstPrompt = (session?.blocks?.length ?? 0) === 0;
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
            if (modelId !== ws.currentModelId) {
              ws.setModel(modelId);
            }
            const nextModel = agentCatalog.data?.providers
              .find((provider) => provider.id === nextProviderId)
              ?.models.find((model) => model.id === modelId);
            const nextLevels = supportedThinkingEffortLevels(nextModel);
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
          // The todos popover is portaled to document.body so it would
          // overlay other tabs if mounted while the agent is hidden in its
          // pane. Gate by the layout-store's visibility selector.
          todos={agentVisible ? (session?.todos ?? null) : null}
          agentTabActive={agentVisible}
          hasMore={ws.hasMore}
          onLoadOlder={ws.loadOlderMessages}
          useWorktree={useWorktree}
          onToggleWorktree={() => setUseWorktree((v) => !v)}
          className="h-full"
        />
      ),
    }),
    [
      activeProviderId,
      agentCatalog.data?.providers,
      agentVisible,
      featureId,
      handleViewDiff,
      projectId,
      resolveModelThinkingEffort,
      session?.blocks?.length,
      session?.todos,
      sessionId,
      slashCommands,
      slashCommandsLoading,
      useWorktree,
      ws,
    ],
  );

  const terminalTab = useMemo(
    () => ({
      label: "Terminal",
      Icon: TerminalIcon,
      shortcut: ["cmd", "shift", "T"],
      content: (
        <FeatureTerminalTab ref={terminalTabRef} featureId={featureId} projectId={projectId} />
      ),
    }),
    [featureId, projectId],
  );

  const gitTab = useMemo(
    () => ({
      label: "Git",
      Icon: GitCompareArrowsIcon,
      shortcut: ["cmd", "shift", "G"],
      badge: <GitBadge gitStats={gitStats} gitBranch={gitBranch} />,
      content: (
        <FeatureGitTab featureId={featureId} diffMode="worktree" onSendComments={sendFromGitTab} />
      ),
    }),
    [featureId, gitBranch, gitStats, sendFromGitTab],
  );

  const editorTab = useMemo(
    () => ({
      label: "Editor",
      Icon: CodeIcon,
      shortcut: ["cmd", "shift", "E"],
      content: projectPathOrCwd ? (
        <Suspense fallback={null}>
          <FeatureEditorTab
            ref={editorTabRef}
            featureId={featureId}
            projectId={projectId}
            projectPath={projectPathOrCwd}
          />
        </Suspense>
      ) : null,
    }),
    [featureId, projectId, projectPathOrCwd],
  );

  const tabs: FeatureTabs = useMemo(
    () => ({ agent: agentTab, terminal: terminalTab, git: gitTab, editor: editorTab }),
    [agentTab, terminalTab, gitTab, editorTab],
  );

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
        wsWorktreeError={session?.worktreeError}
        onRetryWorktreeSetup={handleRetryWorktreeSetup}
      />
      <FeatureLayoutShell
        featureId={featureId}
        tabs={tabs}
        onTerminalActivate={handleTerminalActivate}
        onEditorActivate={handleEditorActivate}
      />
      <DiffViewerModal
        featureId={featureId}
        open={inlineDiffOpen}
        onOpenChange={setInlineDiffOpen}
        onSendComments={sendPromptAndFocus}
      />
    </div>
  );
}
