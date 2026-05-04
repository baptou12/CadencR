import { lazy, Suspense, useMemo } from "react";
import { BotIcon, CodeIcon, GitCompareArrowsIcon, TerminalIcon } from "lucide-react";
import { AgentSession } from "@/components/agent-session";
import { FeatureGitTab } from "@/components/FeatureGitTab";
import { FeatureTerminalTab } from "@/components/FeatureTerminalTab";
import { GitBadge } from "@/components/feature-layout/GitBadge";
import type { FeatureTabDef, FeatureTabs } from "@/components/feature-layout/types";
import { supportedThinkingEffortLevels } from "@/shared/thinking-effort";
import type {
  useSessionControls,
  useSessionFeatureData,
  useSessionRefs,
} from "@/components/WebSocketSessionFeatureBlockHooks";

const FeatureEditorTab = lazy(() => import("@/components/editor/FeatureEditorTab"));
const COMPACT_ACTION_PROVIDERS = new Set(["opencode", "codex_cli"]);

interface UseSessionTabsArgs {
  sessionId: string;
  featureId: number;
  projectId: number;
  data: ReturnType<typeof useSessionFeatureData>;
  controls: ReturnType<typeof useSessionControls>;
  refs: ReturnType<typeof useSessionRefs>;
  agentVisible: boolean;
  hotkeysEnabled: boolean;
  handleViewDiff: () => void;
  sendFromGitTab: (message: string) => void;
}

export function useSessionTabs(args: UseSessionTabsArgs): FeatureTabs {
  const agentTab = useAgentTab(args);
  const terminalTab = useTerminalTab(args);
  const gitTab = useGitTab(args);
  const editorTab = useEditorTab(args);
  return useMemo(
    () => ({ agent: agentTab, terminal: terminalTab, git: gitTab, editor: editorTab }),
    [agentTab, editorTab, gitTab, terminalTab],
  );
}

function useAgentTab(args: UseSessionTabsArgs): FeatureTabDef {
  const { sessionId, featureId, projectId, data, controls, refs, agentVisible, hotkeysEnabled } =
    args;
  const activeFeatureId = hotkeysEnabled ? featureId : undefined;
  const activeProjectId = hotkeysEnabled ? projectId : undefined;
  return useMemo(
    () => ({
      label: "Agent",
      Icon: BotIcon,
      shortcut: ["cmd", "shift", "A"],
      content: (
        <AgentSession
          ref={refs.agent}
          agentType="session"
          featureId={activeFeatureId}
          projectId={activeProjectId}
          wsSessionId={sessionId}
          blocks={controls.ws.blocks}
          rootBlocks={controls.ws.rootBlocks}
          toolResultMap={controls.ws.toolResultMap}
          status={controls.ws.status}
          onSend={(text, images) => handleSend(text, images, data, controls)}
          onStop={controls.ws.interrupt}
          pendingPermission={controls.ws.pendingPermission}
          onPermissionDecision={(decision, feedback, optionId) => {
            controls.ws.respondToPermission(
              controls.ws.pendingRequestId,
              decision,
              feedback,
              optionId,
            );
          }}
          pendingQuestions={
            controls.ws.pendingQuestions.length > 0 ? controls.ws.pendingQuestions : undefined
          }
          onAnswerSubmit={controls.ws.respondToQuestion}
          permissionMode={controls.ws.permissionMode}
          enabledOptInModes={controls.enabledOptInModes}
          onPermissionModeToggle={controls.handlePermissionModeToggle}
          pendingPlanApproval={controls.ws.pendingPlanApproval}
          onPlanApprove={controls.ws.approvePlan}
          onPlanRequestChanges={controls.ws.requestPlanChanges}
          onPlanReject={() => {
            controls.ws.requestPlanChanges("");
            controls.ws.interrupt();
          }}
          contextUsage={controls.ws.contextUsage}
          currentProviderId={controls.ws.currentProviderId}
          onProviderChange={controls.ws.setProvider}
          currentModelId={controls.ws.currentModelId}
          onModelChange={(nextProviderId, modelId) =>
            handleModelChange(nextProviderId, modelId, controls)
          }
          currentThinkingEffort={controls.ws.currentThinkingEffort}
          onThinkingEffortChange={controls.ws.setThinkingEffort}
          hasFileChanges={controls.ws.hasFileChanges}
          onViewDiff={args.handleViewDiff}
          runtimeProvider={controls.ws.runtimeProvider}
          runtimeSessionId={controls.ws.runtimeSessionId || undefined}
          slashCommandsOverride={data.session?.slashCommands ?? []}
          slashCommandsLoading={data.session?.slashCommandsLoading ?? false}
          todos={agentVisible ? (data.session?.todos ?? null) : null}
          disableShortcuts={!hotkeysEnabled}
          agentTabActive={agentVisible && hotkeysEnabled}
          hasMore={controls.ws.hasMore}
          onLoadOlder={controls.ws.loadOlderMessages}
          useWorktree={controls.useWorktree}
          onToggleWorktree={() => controls.setUseWorktree((v) => !v)}
          className="h-full"
        />
      ),
    }),
    [
      activeFeatureId,
      activeProjectId,
      agentVisible,
      args.handleViewDiff,
      controls,
      data,
      hotkeysEnabled,
      refs.agent,
      sessionId,
    ],
  );
}

function useTerminalTab(args: UseSessionTabsArgs): FeatureTabDef {
  const { featureId, projectId, refs } = args;
  return useMemo(
    () => ({
      label: "Terminal",
      Icon: TerminalIcon,
      shortcut: ["cmd", "shift", "T"],
      content: (
        <FeatureTerminalTab ref={refs.terminal} featureId={featureId} projectId={projectId} />
      ),
    }),
    [featureId, projectId, refs.terminal],
  );
}

function useGitTab(args: UseSessionTabsArgs): FeatureTabDef {
  const { featureId, data, sendFromGitTab } = args;
  return useMemo(
    () => ({
      label: "Git",
      Icon: GitCompareArrowsIcon,
      shortcut: ["cmd", "shift", "G"],
      badge: <GitBadge gitStats={data.gitStats} gitBranch={data.gitBranch} />,
      content: (
        <FeatureGitTab featureId={featureId} diffMode="worktree" onSendComments={sendFromGitTab} />
      ),
    }),
    [data.gitBranch, data.gitStats, featureId, sendFromGitTab],
  );
}

function useEditorTab(args: UseSessionTabsArgs): FeatureTabDef {
  const { featureId, projectId, data, refs } = args;
  const projectPathOrCwd = data.effectiveCwd ?? data.projectPath;
  return useMemo(
    () => ({
      label: "Editor",
      Icon: CodeIcon,
      shortcut: ["cmd", "shift", "E"],
      content: projectPathOrCwd ? (
        <Suspense fallback={null}>
          <FeatureEditorTab
            ref={refs.editor}
            featureId={featureId}
            projectId={projectId}
            projectPath={projectPathOrCwd}
          />
        </Suspense>
      ) : null,
    }),
    [featureId, projectId, projectPathOrCwd, refs.editor],
  );
}

function handleSend(
  text: string,
  images: Array<{ base64: string; mimeType: string }> | undefined,
  data: ReturnType<typeof useSessionFeatureData>,
  controls: ReturnType<typeof useSessionControls>,
): void {
  if (text.trim() === "/clear") {
    controls.ws.clearSession();
    return;
  }
  if (text.trim() === "/compact" && COMPACT_ACTION_PROVIDERS.has(controls.activeProviderId)) {
    controls.ws.compactSession();
    return;
  }
  const isFirstPrompt = (data.session?.blocks?.length ?? 0) === 0;
  controls.ws.sendPrompt(text, images, isFirstPrompt && controls.useWorktree ? true : undefined);
}

function handleModelChange(
  nextProviderId: string,
  modelId: string,
  controls: ReturnType<typeof useSessionControls>,
): void {
  if (modelId !== controls.ws.currentModelId) controls.ws.setModel(modelId);
  const nextModel = controls.agentCatalog.data?.providers
    .find((provider) => provider.id === nextProviderId)
    ?.models.find((model) => model.id === modelId);
  const nextLevels = supportedThinkingEffortLevels(nextModel);
  const nextEffort = controls.resolveModelThinkingEffort(nextProviderId, modelId);
  if (nextEffort) {
    controls.ws.setThinkingEffort(nextEffort);
  } else if (!nextLevels.includes(controls.ws.currentThinkingEffort as never)) {
    controls.ws.setThinkingEffort(undefined);
  }
}
