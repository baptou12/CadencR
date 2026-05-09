import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { AgentSessionHandle } from "@/components/agent-session";
import type { FeatureTerminalTabHandle } from "@/components/FeatureTerminalTab";
import { useAgentCatalog } from "@/api/agentRuntime";
import {
  useGetBranch,
  useGetFeatureSettings,
  useListProjects,
  useGetGitStatus,
} from "@/api/generated";
import { useGitStatusSubscription } from "@/hooks/useGitStatusSubscription";
import { useAgentLetterFocus } from "@/hooks/useAgentLetterFocus";
import { useResolvedModel } from "@/hooks/useResolvedModel";
import { useScopedHotkeys } from "@/hooks/useScopedHotkeys";
import { useWebSocketSession } from "@/hooks/useWebSocketSession";
import { useEnabledOptInModes } from "@/hooks/useEnabledOptInModes";
import { nextProviderMode } from "@/lib/provider-modes";
import { nextThinkingEffort, supportedThinkingEffortLevels } from "@/shared/thinking-effort";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { useGitStatusStore } from "@/stores/useGitStatusStore";
import type { PermissionMode } from "@/types/permission-mode";
import type { FeatureEditorTabHandle } from "@/components/editor/FeatureEditorTab";
import type { WorktreeStatus } from "@/types/workflow";

interface SessionRefs {
  agent: RefObject<AgentSessionHandle | null>;
  terminal: RefObject<FeatureTerminalTabHandle | null>;
  editor: RefObject<FeatureEditorTabHandle | null>;
}

interface SessionFeatureData {
  projectPath: string;
  gitBranch: string | undefined;
  defaultBranch: string | undefined;
  featureSettings: Record<string, string>;
  session: ReturnType<typeof useWsSessionStore.getState>["sessions"][string] | undefined;
  effectiveCwd: string;
  worktreeStatus: WorktreeStatus;
  worktreeBranch: string | null;
  requestSlashCommands: ReturnType<typeof useWsSessionStore.getState>["requestSlashCommands"];
  handleRetryWorktreeSetup: () => void;
}

interface SessionControls {
  ws: ReturnType<typeof useWebSocketSession>;
  useWorktree: boolean;
  setUseWorktree: Dispatch<SetStateAction<boolean>>;
  selectedBranch: string | null;
  setSelectedBranch: Dispatch<SetStateAction<string | null>>;
  initializedRef: RefObject<string | null>;
  resolveModelThinkingEffort: ReturnType<typeof useResolvedModel>["resolveModelThinkingEffort"];
  agentCatalog: ReturnType<typeof useAgentCatalog>;
  resolvedProviderId: string;
  resolvedModelId: string;
  resolvedThinkingEffort: string | undefined;
  activeProviderId: string;
  supportedThinkingEfforts: ReturnType<typeof supportedThinkingEffortLevels>;
  enabledOptInModes: PermissionMode[];
  handlePermissionModeToggle: () => void;
  initialCwd: string;
}

export function useSessionRefs(): SessionRefs {
  const agent = useRef<AgentSessionHandle>(null);
  const terminal = useRef<FeatureTerminalTabHandle>(null);
  const editor = useRef<FeatureEditorTabHandle>(null);
  return useMemo(() => ({ agent, terminal, editor }), []);
}

export function useSessionFeatureData(
  sessionId: string,
  cwd: string,
  featureId: number,
  projectId: number,
  options?: { gitMetadataEnabled?: boolean; projectLookupEnabled?: boolean },
): SessionFeatureData {
  const gitMetadataEnabled = options?.gitMetadataEnabled ?? true;
  const projectLookupEnabled = options?.projectLookupEnabled ?? true;
  const projectsQuery = useListProjects({ query: { enabled: projectLookupEnabled } });
  const projectPath = projectsQuery.data?.find((p) => p.id === projectId)?.path;
  useGitStatusSubscription(gitMetadataEnabled ? featureId : null);
  const { data: initialGitStatus } = useGetGitStatus(
    { feature_id: featureId },
    { query: { enabled: gitMetadataEnabled } },
  );
  const { data: branchData } = useGetBranch(
    { project_id: projectId },
    { query: { enabled: gitMetadataEnabled, refetchInterval: 10000 } },
  );
  const { data: featureSettingsData } = useGetFeatureSettings(featureId);
  const featureSettings = useMemo(
    () => Object.fromEntries((featureSettingsData ?? []).map((s) => [s.key, s.value])),
    [featureSettingsData],
  );
  const session = useWsSessionStore((s) => s.sessions[sessionId]);
  const liveWorktreeBranch = useWsSessionStore((s) => s.sessions[sessionId]?.worktreeBranch);
  const requestSlashCommands = useWsSessionStore((s) => s.requestSlashCommands);
  const retryWorktreeSetup = useWsSessionStore((s) => s.retryWorktreeSetup);
  const gitBranch =
    liveWorktreeBranch ?? featureSettings.worktree_branch ?? branchData?.branch ?? undefined;
  const defaultBranch = branchData?.branch ?? undefined;
  const effectiveCwd = session?.worktreePath ?? featureSettings.worktree_path ?? cwd;
  const worktreeStatus =
    session?.worktreeStatus && session.worktreeStatus !== "idle"
      ? session.worktreeStatus
      : statusFromFeatureSettings(featureSettings);
  const worktreeBranch = liveWorktreeBranch ?? featureSettings.worktree_branch ?? null;
  const handleRetryWorktreeSetup = useCallback(
    (): void => retryWorktreeSetup(sessionId),
    [retryWorktreeSetup, sessionId],
  );
  useEffect(() => {
    if (initialGitStatus) {
      useGitStatusStore.getState().setStatus(initialGitStatus);
    }
  }, [initialGitStatus]);
  return useMemo<SessionFeatureData>(
    () => ({
      projectPath: projectPath ?? cwd,
      gitBranch,
      defaultBranch,
      featureSettings,
      session,
      effectiveCwd,
      worktreeStatus,
      worktreeBranch,
      requestSlashCommands,
      handleRetryWorktreeSetup,
    }),
    [
      cwd,
      defaultBranch,
      effectiveCwd,
      featureSettings,
      gitBranch,
      handleRetryWorktreeSetup,
      projectPath,
      requestSlashCommands,
      session,
      worktreeBranch,
      worktreeStatus,
    ],
  );
}

function statusFromFeatureSettings(settings: Record<string, string>): WorktreeStatus {
  const raw = settings.worktree_setup_step;
  if (raw === "ready") return "ready";
  if (raw === "setup_running" || raw === "setup") return "setup_running";
  if (raw === "setup_error" || raw === "error") return "setup_error";
  if (raw === "created") return "created";
  if (raw === "creating" || raw === "naming" || raw === "named") return "creating";
  return settings.worktree_path || settings.worktree_branch ? "ready" : "idle";
}

export function useSessionControls(
  sessionId: string,
  featureId: number,
  projectId: number,
  cwd: string,
  featureSettings: Record<string, string>,
  options?: { loadPersistedState?: boolean },
): SessionControls {
  const ws = useWebSocketSession(sessionId, featureId, {
    loadPersisted: options?.loadPersistedState ?? true,
  });
  const [useWorktree, setUseWorktree] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const initializedRef = useRef<string | null>(null);
  const { resolveModel, resolveProvider, resolveModelThinkingEffort } = useResolvedModel(
    featureId,
    projectId,
  );
  const agentCatalog = useAgentCatalog();
  const resolvedProviderId = resolveProvider("session");
  const resolvedModelId = resolveModel("session");
  const resolvedThinkingEffort = resolveModelThinkingEffort(resolvedProviderId, resolvedModelId);
  const activeProviderId = ws.runtimeProvider || ws.currentProviderId || resolvedProviderId;
  const activeSessionModel = agentCatalog.data?.providers
    .find((provider) => provider.id === (ws.currentProviderId || resolvedProviderId))
    ?.models.find((model) => model.id === (ws.currentModelId || resolvedModelId));
  const supportedThinkingEfforts = supportedThinkingEffortLevels(activeSessionModel);
  const enabledOptInModes = useEnabledOptInModes(activeProviderId);
  const handlePermissionModeToggle = usePermissionModeToggle(
    sessionId,
    activeProviderId,
    enabledOptInModes,
  );
  return useMemo<SessionControls>(
    () => ({
      ws,
      useWorktree,
      setUseWorktree,
      selectedBranch,
      setSelectedBranch,
      initializedRef,
      resolveModelThinkingEffort,
      agentCatalog,
      resolvedProviderId,
      resolvedModelId,
      resolvedThinkingEffort,
      activeProviderId,
      supportedThinkingEfforts,
      enabledOptInModes,
      handlePermissionModeToggle,
      initialCwd: featureSettings.worktree_path ?? cwd,
    }),
    [
      activeProviderId,
      agentCatalog,
      cwd,
      enabledOptInModes,
      featureSettings.worktree_path,
      handlePermissionModeToggle,
      initializedRef,
      resolveModelThinkingEffort,
      resolvedModelId,
      resolvedProviderId,
      resolvedThinkingEffort,
      selectedBranch,
      supportedThinkingEfforts,
      useWorktree,
      ws,
    ],
  );
}

function usePermissionModeToggle(
  sessionId: string,
  activeProviderId: string,
  enabledOptInModes: PermissionMode[],
): () => void {
  return useCallback((): void => {
    const store = useWsSessionStore.getState();
    const session = store.sessions[sessionId];
    if (!session) return;
    const next = nextProviderMode(activeProviderId, session.permissionMode, enabledOptInModes);
    if (next !== session.permissionMode) store.setPermissionMode(sessionId, next);
  }, [activeProviderId, enabledOptInModes, sessionId]);
}

export function useWsSessionEffects(args: {
  sessionId: string;
  cwd: string;
  featureId: number;
  data: ReturnType<typeof useSessionFeatureData>;
  controls: ReturnType<typeof useSessionControls>;
  refs: ReturnType<typeof useSessionRefs>;
  focusedTabId: string;
  hotkeysEnabled: boolean;
  autoFocusPrompt: boolean;
  autoInitSession: boolean;
}): void {
  const {
    sessionId,
    cwd,
    featureId,
    data,
    controls,
    refs,
    focusedTabId,
    hotkeysEnabled,
    autoFocusPrompt,
    autoInitSession,
  } = args;
  const { ws } = controls;
  const { initSession, isConnected } = ws;
  const serverSessionId = data.session?.serverSessionId;
  useAgentLetterFocus({
    enabled: hotkeysEnabled && focusedTabId === "agent",
    onFocus: () => refs.agent.current?.focusActiveInput(),
  });
  useEffect(() => {
    if (!autoInitSession) return;
    if (!isConnected || controls.initializedRef.current === sessionId) return;
    if (serverSessionId !== "") return;
    controls.initializedRef.current = sessionId;
    initSession({
      cwd,
      featureId,
      provider: controls.resolvedProviderId,
      model: controls.resolvedModelId,
      thinkingEffort: controls.resolvedThinkingEffort,
    });
  }, [
    autoInitSession,
    controls.initializedRef,
    controls.resolvedModelId,
    controls.resolvedProviderId,
    controls.resolvedThinkingEffort,
    cwd,
    featureId,
    initSession,
    isConnected,
    serverSessionId,
    sessionId,
  ]);
  useEffect(() => {
    if (!autoFocusPrompt) return undefined;
    if (!hotkeysEnabled || focusedTabId !== "agent") return undefined;
    const frame = requestAnimationFrame(() => refs.agent.current?.focusPromptBar());
    return () => cancelAnimationFrame(frame);
  }, [autoFocusPrompt, focusedTabId, hotkeysEnabled, refs.agent, sessionId]);
  useEffect(() => {
    const handler = (): void => {
      if (hotkeysEnabled) refs.agent.current?.focusPromptBar();
    };
    window.addEventListener("cadencr:focus-prompt", handler);
    return () => window.removeEventListener("cadencr:focus-prompt", handler);
  }, [hotkeysEnabled, refs.agent]);
  useEffect(() => {
    if (!hotkeysEnabled) return;
    if (serverSessionId && data.effectiveCwd) {
      data.requestSlashCommands(sessionId, data.effectiveCwd, controls.activeProviderId);
    }
  }, [
    controls.activeProviderId,
    data.effectiveCwd,
    data.requestSlashCommands,
    hotkeysEnabled,
    serverSessionId,
    sessionId,
  ]);
}

export function useWsSessionShortcuts(args: {
  controls: ReturnType<typeof useSessionControls>;
  setInlineDiffOpen: (open: boolean) => void;
  hotkeysEnabled: boolean;
}): void {
  const { controls, setInlineDiffOpen, hotkeysEnabled } = args;
  useScopedHotkeys(
    "meta+g",
    (e) => {
      e.preventDefault();
      setInlineDiffOpen(true);
    },
    "agent",
    { enabled: hotkeysEnabled, enableOnFormTags: true, enableOnContentEditable: true },
  );
  useScopedHotkeys(
    "meta+t",
    (e) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.closest("[data-agent-prompt-bar='true']")) {
        return;
      }
      if (controls.supportedThinkingEfforts.length === 0) return;
      e.preventDefault();
      const next = nextThinkingEffort(
        controls.supportedThinkingEfforts,
        controls.ws.currentThinkingEffort,
      );
      if (next) controls.ws.setThinkingEffort(next);
    },
    "agent",
    { enabled: hotkeysEnabled, enableOnFormTags: true, enableOnContentEditable: true },
  );
}
