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
import { useAgentCatalog, type RuntimeProviderModeOption } from "@/api/agentRuntime";
import { useGetProjectSettings, useSetProjectSetting } from "@/api/generated";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-errors";
import { useResolvedModelContext } from "@/contexts/ResolvedModelContext";
import type { useResolvedModel } from "@/hooks/useResolvedModel";
import { useWebSocketSession } from "@/hooks/useWebSocketSession";
import { useEnabledOptInModes } from "@/hooks/useEnabledOptInModes";
import {
  DEFAULT_WORKTREE_MODE_KEY,
  defaultWorktreeModeFromSettings,
} from "@/lib/default-worktree-mode";
import {
  defaultWorktreeMode,
  worktreeModeToProjectDefault,
  type WorktreeMode,
} from "@/lib/worktree-mode";
import { supportedThinkingEffortLevels } from "@/shared/thinking-effort";
import type { PermissionMode } from "@/types/permission-mode";
import type { CodexPermissionMode } from "@/types/codex-permission-mode";
import { useCodexPermissionModeSetting } from "@/hooks/useCodexPermissionModeSetting";
import {
  EMPTY_PROVIDER_MODES,
  usePermissionModeToggle,
} from "@/components/WebSocketSessionPermissionMode";
import { PROVIDER_IDS } from "@/lib/providers";
import {
  useClaudeProfileSelection,
  type ClaudeProfileSelection,
} from "@/components/agent-session/useClaudeProfileSelection";

type WsSession = ReturnType<typeof useWebSocketSession>;

interface WorktreePreferenceControls {
  worktreeMode: WorktreeMode;
  setWorktreeMode: (mode: WorktreeMode) => void;
}

interface RuntimeSelectionControls {
  agentCatalog: ReturnType<typeof useAgentCatalog>;
  resolvedProviderId: string;
  resolvedModelId: string;
  resolvedThinkingEffort: string | undefined;
  activeProviderId: string;
  supportedThinkingEfforts: ReturnType<typeof supportedThinkingEffortLevels>;
  enabledOptInModes: PermissionMode[];
  providerModes: readonly RuntimeProviderModeOption[];
  resolveModelThinkingEffort: ReturnType<typeof useResolvedModel>["resolveModelThinkingEffort"];
}

interface CodexAccessControls {
  codexPermissionMode: CodexPermissionMode;
  codexPermissionDefaultMode: CodexPermissionMode;
  isCodexPermissionModePending: boolean;
  handleCodexPermissionModeChange: (mode: CodexPermissionMode) => void;
}

export interface SessionControls
  extends WorktreePreferenceControls, RuntimeSelectionControls, CodexAccessControls {
  ws: WsSession;
  selectedBranch: string | null;
  setSelectedBranch: Dispatch<SetStateAction<string | null>>;
  initializedRef: RefObject<string | null>;
  handlePermissionModeToggle: () => void;
  claudeProfile: ClaudeProfileSelection;
  initialCwd: string;
}

function useWorktreePreference(projectId: number): WorktreePreferenceControls {
  const [worktreeMode, setWorktreeModeState] = useState<WorktreeMode>("on_branch");
  const seededProjectRef = useRef<number | null>(null);
  const { data: projectSettingsData } = useGetProjectSettings(projectId);
  const setProjectSetting = useSetProjectSetting();
  const projectDefault = defaultWorktreeModeFromSettings(projectSettingsData, "skip");
  // Seed the picker from the project's saved default once settings load — once
  // per project so a later settle doesn't clobber an explicit choice.
  useEffect(() => {
    if (projectSettingsData == null || seededProjectRef.current === projectId) {
      return;
    }
    seededProjectRef.current = projectId;
    setWorktreeModeState(defaultWorktreeMode(projectDefault));
  }, [projectDefault, projectId, projectSettingsData]);
  const setWorktreeMode = useCallback(
    (next: WorktreeMode): void => {
      setWorktreeModeState(next);
      // Persist the project default only for the two modes that map cleanly to
      // it; branch-specific modes (reuse / from_branch) leave it untouched. A
      // failed save still keeps the local pick for this session.
      const nextDefault = worktreeModeToProjectDefault(next);
      if (nextDefault == null || nextDefault === projectDefault) return;
      setProjectSetting.mutate(
        { id: projectId, data: { key: DEFAULT_WORKTREE_MODE_KEY, value: nextDefault } },
        {
          onError: (err) => toast.error(apiErrorMessage(err, "Failed to save worktree preference")),
        },
      );
    },
    [projectDefault, projectId, setProjectSetting],
  );
  return useMemo(() => ({ worktreeMode, setWorktreeMode }), [setWorktreeMode, worktreeMode]);
}

function useRuntimeSelection(
  ws: WsSession,
  effectiveCwd: string,
  agentCatalogEnabled: boolean,
): RuntimeSelectionControls {
  const { resolveModel, resolveProvider, resolveModelThinkingEffort } = useResolvedModelContext();
  const agentCatalog = useAgentCatalog({
    cwd: effectiveCwd,
    enabled: agentCatalogEnabled,
    staleTime: 30_000,
  });
  const resolvedProviderId = resolveProvider("session");
  const resolvedModelId = resolveModel("session");
  const resolvedThinkingEffort = resolveModelThinkingEffort(resolvedProviderId, resolvedModelId);
  const activeProviderId = ws.runtimeProvider || ws.currentProviderId || resolvedProviderId;
  const activeSessionModel = agentCatalog.data?.providers
    .find((provider) => provider.id === (ws.currentProviderId || resolvedProviderId))
    ?.models.find((model) => model.id === (ws.currentModelId || resolvedModelId));
  const supportedThinkingEfforts = supportedThinkingEffortLevels(activeSessionModel);
  const enabledOptInModes = useEnabledOptInModes(activeProviderId);
  const providerModes =
    agentCatalog.data?.providers.find((provider) => provider.id === activeProviderId)?.modes ??
    EMPTY_PROVIDER_MODES;
  return useMemo(
    () => ({
      agentCatalog,
      resolvedProviderId,
      resolvedModelId,
      resolvedThinkingEffort,
      activeProviderId,
      supportedThinkingEfforts,
      enabledOptInModes,
      providerModes,
      resolveModelThinkingEffort,
    }),
    [
      activeProviderId,
      agentCatalog,
      enabledOptInModes,
      providerModes,
      resolveModelThinkingEffort,
      resolvedModelId,
      resolvedProviderId,
      resolvedThinkingEffort,
      supportedThinkingEfforts,
    ],
  );
}

function useCodexAccessControls(ws: WsSession): CodexAccessControls {
  const {
    globalCodexPermissionMode,
    isPending: isCodexPermissionModePending,
    handleCodexPermissionModeChange: handleGlobalCodexPermissionModeChange,
  } = useCodexPermissionModeSetting();
  const hasStartedConversation = ws.blocks.length > 0 || ws.runtimeSessionId !== "";
  const codexPermissionMode = hasStartedConversation
    ? ws.codexPermissionMode
    : globalCodexPermissionMode;
  const handleCodexPermissionModeChange = useCallback(
    (mode: CodexPermissionMode): void => {
      ws.setCodexPermissionMode(mode);
      handleGlobalCodexPermissionModeChange(mode);
    },
    [handleGlobalCodexPermissionModeChange, ws],
  );
  return useMemo(
    () => ({
      codexPermissionMode,
      codexPermissionDefaultMode: globalCodexPermissionMode,
      isCodexPermissionModePending,
      handleCodexPermissionModeChange,
    }),
    [
      codexPermissionMode,
      globalCodexPermissionMode,
      handleCodexPermissionModeChange,
      isCodexPermissionModePending,
    ],
  );
}

export function useSessionControls(
  sessionId: string,
  featureId: number,
  projectId: number,
  effectiveCwd: string,
  options?: { agentCatalogEnabled?: boolean; loadPersistedState?: boolean },
): SessionControls {
  const ws = useWebSocketSession(sessionId, featureId, {
    loadPersisted: options?.loadPersistedState ?? true,
  });
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const initializedRef = useRef<string | null>(null);
  const worktree = useWorktreePreference(projectId);
  const runtime = useRuntimeSelection(ws, effectiveCwd, options?.agentCatalogEnabled ?? true);
  const codex = useCodexAccessControls(ws);
  const claudeProfile = useClaudeProfileSelection({
    isClaudeProvider: runtime.activeProviderId === PROVIDER_IDS.CLAUDE_CODE,
    wsSessionId: sessionId,
  });
  const handlePermissionModeToggle = usePermissionModeToggle(
    sessionId,
    runtime.activeProviderId,
    runtime.enabledOptInModes,
    runtime.providerModes,
  );
  return useMemo<SessionControls>(
    () => ({
      ws,
      ...worktree,
      selectedBranch,
      setSelectedBranch,
      initializedRef,
      ...runtime,
      handlePermissionModeToggle,
      claudeProfile,
      ...codex,
      initialCwd: effectiveCwd,
    }),
    [
      claudeProfile,
      codex,
      effectiveCwd,
      handlePermissionModeToggle,
      initializedRef,
      runtime,
      selectedBranch,
      worktree,
      ws,
    ],
  );
}
