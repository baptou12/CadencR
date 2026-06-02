import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { AgentSessionHandle } from "@/components/agent-session";
import type { FeatureTerminalTabHandle } from "@/components/FeatureTerminalTab";
import {
  useGetBranch,
  useGetFeatureSettings,
  useGetGitStatus,
  useListProjects,
} from "@/api/generated";
import { useGitStatusSubscription } from "@/hooks/useGitStatusSubscription";
import { useAgentLetterFocus } from "@/hooks/useAgentLetterFocus";
import { useScopedShortcut } from "@/hooks/useShortcut";
import { nextThinkingEffort } from "@/shared/thinking-effort";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { useGitStatusStore } from "@/stores/useGitStatusStore";
import type { FeatureEditorTabHandle } from "@/components/editor/FeatureEditorTab";
import type { WorktreeStatus } from "@/types/workflow";
import type { SessionControls } from "@/components/WebSocketSessionControls";
export { useSessionControls } from "@/components/WebSocketSessionControls";
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
  const projectsQuery = useListProjects({
    query: { enabled: projectLookupEnabled },
  });
  const projectPath = projectsQuery.data?.find((p) => p.id === projectId)?.path;
  useGitStatusSubscription(gitMetadataEnabled ? featureId : null);
  const { data: initialGitStatus } = useGetGitStatus(
    { feature_id: featureId },
    { query: { enabled: gitMetadataEnabled } },
  );
  const { data: branchData } = useGetBranch(
    { project_id: projectId },
    { query: { enabled: gitMetadataEnabled } },
  );
  const { data: featureSettingsData } = useGetFeatureSettings(featureId);
  const featureSettings = useMemo(
    () =>
      Object.fromEntries(
        (featureSettingsData ?? []).map((setting) => [setting.key, setting.value]),
      ),
    [featureSettingsData],
  );
  const session = useWsSessionStore((state) => state.sessions[sessionId]);
  const liveWorktreeBranch = useWsSessionStore(
    (state) => state.sessions[sessionId]?.worktreeBranch,
  );
  const requestSlashCommands = useWsSessionStore((state) => state.requestSlashCommands);
  const retryWorktreeSetup = useWsSessionStore((state) => state.retryWorktreeSetup);
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
  if (raw === "creating" || raw === "naming" || raw === "named") {
    return "creating";
  }
  return settings.worktree_path || settings.worktree_branch ? "ready" : "idle";
}

export function useWsSessionEffects(args: {
  sessionId: string;
  cwd: string;
  featureId: number;
  data: ReturnType<typeof useSessionFeatureData>;
  controls: SessionControls;
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
  const persistedLoaded = data.session?.persistedLoaded ?? false;
  useAgentLetterFocus({
    enabled: hotkeysEnabled && focusedTabId === "agent",
    onFocus: () => refs.agent.current?.focusActiveInput(),
  });
  useEffect(() => {
    if (!autoInitSession) return;
    if (!isConnected || controls.initializedRef.current === sessionId) return;
    if (serverSessionId !== "") return;
    // Wait for the persisted snapshot before initializing so the payload
    // carries the restored permission mode. Otherwise the entry's default
    // (`acceptEdits`) is sent and the backend's COALESCE overwrites the
    // persisted mode — the silent revert that loses a sticky `bypassPermissions`
    // after a reload/reconnect. `autoInitSession` and persisted loading are both
    // gated on `!embedded`, so `persistedLoaded` always settles here.
    if (!persistedLoaded) return;
    controls.initializedRef.current = sessionId;
    initSession({
      cwd,
      featureId,
      provider: controls.resolvedProviderId,
      model: controls.resolvedModelId,
      thinkingEffort: controls.resolvedThinkingEffort,
      // Pass the user's currently-selected mode so the backend can apply it
      // via `--permission-mode` (Claude Code) / `session/set_mode` (ACP) at
      // spawn time. Without this the backend silently falls back to its
      // provider default in `session_init.rs`, which only matches the FE's
      // local selection by coincidence — that's the race that made the
      // first prompt land in the wrong mode.
      permissionMode: controls.ws.permissionMode,
    });
  }, [
    autoInitSession,
    controls.initializedRef,
    controls.resolvedModelId,
    controls.resolvedProviderId,
    controls.resolvedThinkingEffort,
    controls.ws.permissionMode,
    cwd,
    featureId,
    initSession,
    isConnected,
    persistedLoaded,
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
  controls: SessionControls;
  hotkeysEnabled: boolean;
}): void {
  const { controls, hotkeysEnabled } = args;
  useScopedShortcut(
    "agent-thinking",
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
    { enabled: hotkeysEnabled },
  );
}
