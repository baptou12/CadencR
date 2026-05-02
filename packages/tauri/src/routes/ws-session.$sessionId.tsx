import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { BotIcon, CodeIcon, GitCompareArrowsIcon, TerminalIcon } from "lucide-react";
import { useScopedHotkeys } from "@/hooks/useScopedHotkeys";
import { AgentSession, type AgentSessionHandle } from "@/components/agent-session";
import { DiffViewerModal } from "@/components/diff/DiffViewerModal";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { FeatureTerminalTab, type FeatureTerminalTabHandle } from "@/components/FeatureTerminalTab";
import { FeatureGitTab } from "@/components/FeatureGitTab";
import { FeatureLayoutShell } from "@/components/feature-layout/FeatureLayoutShell";
import { FeatureLayoutProvider } from "@/components/feature-layout/FeatureLayoutContext";
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
  getFocusedTab,
  isTabVisible,
} from "@/stores/feature-layout-store";
import { ROOT_LEAF_ID } from "@/stores/feature-layout-schema";
import {
  useGetStats,
  useGetBranch,
  useGetFeatureSettings,
  useGetWorkspaceSetting,
  useListProjects,
} from "@/api/generated";
import { nextThinkingEffort, supportedThinkingEffortLevels } from "@/shared/thinking-effort";
import { nextProviderMode } from "@/lib/provider-modes";
import {
  CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY,
  CODEX_FULL_ACCESS_SETTING_KEY,
} from "@/shared/permission-mode-settings";
import { PROVIDER_IDS } from "@/lib/providers";
import type { PermissionMode } from "@/types/permission-mode";
import type { FeatureEditorTabHandle } from "@/components/editor/FeatureEditorTab";

const FeatureEditorTab = lazy(() => import("@/components/editor/FeatureEditorTab"));

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
  return (
    <FeatureLayoutProvider featureId={featureId}>
      <WebSocketSessionPageBody
        sessionId={sessionId}
        cwd={cwd}
        featureId={featureId}
        projectId={projectId}
      />
    </FeatureLayoutProvider>
  );
}

interface WebSocketSessionPageBodyProps {
  sessionId: string;
  cwd: string;
  featureId: number;
  projectId: number;
}

function WebSocketSessionPageBody({
  sessionId,
  cwd,
  featureId,
  projectId,
}: WebSocketSessionPageBodyProps) {
  const layoutState = useFeatureLayoutStore(selectFeatureLayout(featureId));
  const focusedTabId = getFocusedTab(layoutState) ?? "agent";
  useSaveLastOpenedFeature(projectId, featureId, focusedTabId);
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
  const resolvedThinkingEffort = resolveModelThinkingEffort(resolvedProviderId, resolvedModelId);
  const activeSessionModel = agentCatalog.data?.providers
    .find((provider) => provider.id === (ws.currentProviderId || resolvedProviderId))
    ?.models.find((model) => model.id === (ws.currentModelId || resolvedModelId));
  const supportedThinkingEfforts = supportedThinkingEffortLevels(activeSessionModel);
  const activeProviderId = ws.runtimeProvider || ws.currentProviderId || resolvedProviderId;

  // Per-provider opt-in toggles. Modes flagged `optIn: true` in the catalog
  // (Claude `bypassPermissions`, Codex `bypassPermissions`/full-access) only
  // join the cycle when their workspace setting is `"true"`. Each toggle is
  // scoped to its own provider — we filter the resulting list by what the
  // active provider would actually expose.
  const claudeBypassSetting = useGetWorkspaceSetting(CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY);
  const codexFullAccessSetting = useGetWorkspaceSetting(CODEX_FULL_ACCESS_SETTING_KEY);
  const enabledOptInModes = useMemo<PermissionMode[]>(() => {
    const out: PermissionMode[] = [];
    if (
      activeProviderId === PROVIDER_IDS.CLAUDE_CODE &&
      claudeBypassSetting.data?.value === "true"
    ) {
      out.push("bypassPermissions");
    }
    if (
      activeProviderId === PROVIDER_IDS.CODEX_CLI &&
      codexFullAccessSetting.data?.value === "true"
    ) {
      out.push("bypassPermissions");
    }
    return out;
  }, [activeProviderId, claudeBypassSetting.data?.value, codexFullAccessSetting.data?.value]);

  // Stable across re-renders triggered by WS chunks — keeps MetaBar's
  // mode-chip `useMemo` from busting on every streamed message.
  const handlePermissionModeToggle = useCallback((): void => {
    const store = useWsSessionStore.getState();
    const session = store.sessions[sessionId];
    if (!session) return;
    const current = session.permissionMode;
    const next = nextProviderMode(activeProviderId, current, enabledOptInModes);
    if (next !== current) {
      store.setPermissionMode(sessionId, next);
    }
  }, [activeProviderId, enabledOptInModes, sessionId]);

  const effectiveCwd = session?.worktreePath ?? featureSettings.worktree_path ?? cwd;

  const setPaneActiveTab = useFeatureLayoutStore((s) => s.setPaneActiveTab);
  const setRootActive = useCallback(
    (tab: import("@/stores/feature-layout-schema").TabKind) => {
      setPaneActiveTab(featureId, ROOT_LEAF_ID, tab);
    },
    [featureId, setPaneActiveTab],
  );

  const agentSessionRef = useRef<AgentSessionHandle>(null);
  const focusAgentFromLetter = useCallback((): void => {
    agentSessionRef.current?.focusActiveInput();
  }, []);
  useAgentLetterFocus({
    enabled: focusedTabId === "agent",
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
  // Both shortcuts must fire while focus is inside the prompt editor (a
  // contenteditable) — Cmd+T explicitly checks `data-agent-prompt-bar` to
  // narrow itself further. Without these flags react-hotkeys-hook skips the
  // event when typing in the prompt.
  useScopedHotkeys(
    "meta+g",
    (e) => {
      e.preventDefault();
      setInlineDiffOpen(true);
    },
    "agent",
    { enableOnFormTags: true, enableOnContentEditable: true },
  );
  useScopedHotkeys(
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
    "agent",
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
    if (focusedTabId !== "agent") return undefined;
    const frame = requestAnimationFrame(() => {
      agentSessionRef.current?.focusPromptBar();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedTabId, sessionId]);

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
          rootBlocks={ws.rootBlocks}
          toolResultMap={ws.toolResultMap}
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
          enabledOptInModes={enabledOptInModes}
          onPermissionModeToggle={handlePermissionModeToggle}
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
      enabledOptInModes,
      featureId,
      handlePermissionModeToggle,
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
