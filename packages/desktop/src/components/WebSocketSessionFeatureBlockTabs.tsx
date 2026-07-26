import { lazy, Suspense, useCallback, useMemo, useRef, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BotIcon, CodeIcon, GitCompareArrowsIcon, GlobeIcon, TerminalIcon } from "lucide-react";
import { resolveWorktreeChoice } from "@/lib/worktree-mode";
import { checkoutSelectedBranch, saveWorktreeChoice } from "@/components/worktree-send-helpers";
import type { FirstPromptBranchSetup } from "@/lib/ws-envelope";
import { FeatureGitTab } from "@/components/FeatureGitTab";
import { FeatureTerminalTab } from "@/components/FeatureTerminalTab";
import { GitBadge } from "@/components/feature-layout/GitBadge";
import type { FeatureTabDef, FeatureTabs } from "@/components/feature-layout/types";
import { useCheckoutBranch, useSetFeatureSetting } from "@/api/generated";
import type { PromptAttachmentPayload } from "@/types/agent-types";
import { claudeProfileForPrompt } from "@/components/WebSocketSessionFeatureBlockHooks";
import type {
  useSessionControls,
  useSessionFeatureData,
  useSessionRefs,
} from "@/components/WebSocketSessionFeatureBlockHooks";
import type { NonAgentTabReadiness } from "@/components/useAgentFirstNonAgentWork";
import { SessionAgentTab } from "@/components/WebSocketSessionAgentTab";
const FeatureEditorTab = lazy(() => import("@/components/editor/FeatureEditorTab"));
const BrowserWorkspaceTab = lazy(() =>
  import("@/components/BrowserWorkspaceTab").then((module) => ({
    default: module.BrowserWorkspaceTab,
  })),
);
const COMPACT_ACTION_PROVIDERS = new Set(["opencode", "codex_cli", "cursor"]);
interface UseSessionTabsArgs {
  sessionId: string;
  featureId: number;
  // Scope that owns this block's layout + browser tabs. Equals `featureId` on
  // the feature route, but a distinct per-card id in the unified grid, so each
  // card's Browser stays isolated.
  layoutFeatureId: number;
  projectId: number;
  data: ReturnType<typeof useSessionFeatureData>;
  controls: ReturnType<typeof useSessionControls>;
  refs: ReturnType<typeof useSessionRefs>;
  agentVisible: boolean;
  /** Per-kind readiness; tabs reveal in priority order after the agent paints. */
  tabReady: NonAgentTabReadiness;
  hotkeysEnabled: boolean;
  sendFromGitTab: (message: string) => void;
}

export function useSessionTabs(args: UseSessionTabsArgs): FeatureTabs {
  const agentTab = useAgentTab(args);
  const terminalTab = useTerminalTab(args);
  const gitTab = useGitTab(args);
  const editorTab = useEditorTab(args);
  const browserTab = useBrowserTab(args);
  return useMemo(
    () => ({
      agent: agentTab,
      terminal: terminalTab,
      git: gitTab,
      editor: editorTab,
      browser: browserTab,
    }),
    [agentTab, browserTab, editorTab, gitTab, terminalTab],
  );
}

function useAgentTab(args: UseSessionTabsArgs): FeatureTabDef {
  const { sessionId, featureId, projectId, data, controls, refs, agentVisible, hotkeysEnabled } =
    args;
  const onSend = useAgentSendHandler({ featureId, projectId, data, controls });
  const hasAccessModes = controls.providerAccessModes.length > 0;
  return useMemo(
    () => ({
      label: "Agent",
      Icon: BotIcon,
      shortcut: ["cmd", "shift", "A"],
      content: (
        <SessionAgentTab
          sessionId={sessionId}
          featureId={featureId}
          projectId={projectId}
          data={data}
          controls={controls}
          agentRef={refs.agent}
          agentVisible={agentVisible}
          hotkeysEnabled={hotkeysEnabled}
          hasAccessModes={hasAccessModes}
          onSend={onSend}
        />
      ),
    }),
    [
      agentVisible,
      controls,
      data,
      featureId,
      hotkeysEnabled,
      hasAccessModes,
      onSend,
      projectId,
      refs.agent,
      sessionId,
    ],
  );
}

function useTerminalTab(args: UseSessionTabsArgs): FeatureTabDef {
  const { featureId, projectId, refs } = args;
  const terminalReady = args.tabReady.terminal;
  return useMemo(
    () => ({
      label: "Terminal",
      Icon: TerminalIcon,
      shortcut: ["cmd", "shift", "T"],
      content: terminalReady ? (
        <FeatureTerminalTab ref={refs.terminal} featureId={featureId} projectId={projectId} />
      ) : (
        <DeferredTabContent label="Terminal" />
      ),
    }),
    [featureId, terminalReady, projectId, refs.terminal],
  );
}

function useGitTab(args: UseSessionTabsArgs): FeatureTabDef {
  const { featureId, projectId, data, sendFromGitTab } = args;
  const gitReady = args.tabReady.git;
  // The live session controls replace `sendFromGitTab` throughout streaming.
  // Keep the tab prop stable while always dispatching through the latest one;
  // otherwise every agent block rebuilds the memoized Git panel.
  const sendFromGitTabRef = useRef(sendFromGitTab);
  sendFromGitTabRef.current = sendFromGitTab;
  const handleSendComments = useCallback(
    (message: string): void => sendFromGitTabRef.current(message),
    [],
  );
  return useMemo(
    () => ({
      label: "Git",
      Icon: GitCompareArrowsIcon,
      shortcut: ["cmd", "shift", "G"],
      badge: <GitBadge featureId={featureId} gitBranch={data.gitBranch} />,
      content: gitReady ? (
        <FeatureGitTab
          featureId={featureId}
          projectId={projectId}
          diffMode="worktree"
          onSendComments={handleSendComments}
        />
      ) : (
        <DeferredTabContent label="Git" />
      ),
    }),
    [data.gitBranch, featureId, gitReady, handleSendComments, projectId],
  );
}

function useBrowserTab(args: UseSessionTabsArgs): FeatureTabDef {
  // Scope the Browser by the real featureId (not layoutFeatureId): the agent's
  // MCP is pinned to featureId, so its tabs are created in that scope. Using the
  // same id here is what makes agent-opened tabs appear in this panel.
  const { controls, featureId } = args;
  const browserReady = args.tabReady.browser;
  const sendContext = useCallback(
    (message: string, images?: Array<{ base64: string; mimeType: string }>): void =>
      controls.ws.sendPrompt(message, {
        attachments: images?.map((image, index) => ({
          base64: image.base64,
          mimeType: image.mimeType,
          fileName: images.length > 1 ? `browser-context-${index + 1}.png` : "browser-context.png",
          kind: "image" as const,
        })),
        claudeProfile: claudeProfileForPrompt(controls),
      }),
    [controls],
  );
  return useMemo(
    () => ({
      label: "Browser",
      Icon: GlobeIcon,
      shortcut: ["cmd", "shift", "B"],
      content: browserReady ? (
        <Suspense fallback={null}>
          <BrowserWorkspaceTab scopeId={featureId} onSendContext={sendContext} />
        </Suspense>
      ) : (
        <DeferredTabContent label="Browser" />
      ),
    }),
    [featureId, browserReady, sendContext],
  );
}

function useEditorTab(args: UseSessionTabsArgs): FeatureTabDef {
  const { featureId, projectId, data, refs } = args;
  const editorReady = args.tabReady.editor;
  const projectPathOrCwd = data.effectiveCwd ?? data.projectPath;
  return useMemo(
    () => ({
      label: "Editor",
      Icon: CodeIcon,
      shortcut: ["cmd", "shift", "E"],
      content: !editorReady ? (
        <DeferredTabContent label="Editor" />
      ) : projectPathOrCwd ? (
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
    [featureId, editorReady, projectId, projectPathOrCwd, refs.editor],
  );
}

function DeferredTabContent({ label }: { label: string }): ReactElement {
  return (
    <div className="flex h-full items-center justify-center px-4 text-sm text-muted-foreground">
      Loading {label} after the conversation…
    </div>
  );
}
function useAgentSendHandler(args: {
  featureId: number;
  projectId: number;
  data: ReturnType<typeof useSessionFeatureData>;
  controls: ReturnType<typeof useSessionControls>;
}): (
  text: string,
  attachments?: PromptAttachmentPayload[],
  claudeProfile?: string,
) => Promise<void> {
  const { featureId, projectId, data, controls } = args;
  const queryClient = useQueryClient();
  const setFeatureSetting = useSetFeatureSetting();
  const checkoutMutateAsync = useCheckoutBranch().mutateAsync;
  return useCallback(
    async (text, attachments, claudeProfile) => {
      if (text.trim() === "/clear") {
        controls.ws.clearSession();
        return;
      }
      if (text.trim() === "/compact" && COMPACT_ACTION_PROVIDERS.has(controls.activeProviderId)) {
        controls.ws.compactSession();
        return;
      }
      const isFirstPrompt = (data.session?.blocks?.length ?? 0) === 0;
      const choice = resolveWorktreeChoice({
        mode: controls.worktreeMode,
        selectedBranch: controls.selectedBranch,
        defaultBranch: data.defaultBranch,
      });
      // First-prompt branch provisioning the backend acts on *after* auto-naming
      // (so the new branch carries the feature's name). `undefined` = no setup.
      let branchSetup: FirstPromptBranchSetup | undefined;
      if (isFirstPrompt) {
        if (choice.backendMode === "skip") {
          // "On branch": run in the project folder, switching to the picked
          // branch first when it differs from the current one.
          if (choice.checkout != null) {
            const ok = await checkoutSelectedBranch({
              branch: choice.checkout,
              projectId,
              featureId,
              queryClient,
              checkoutMutateAsync,
            });
            if (!ok) return;
          }
        } else if (choice.backendMode === "project_branch") {
          // "From branch": the backend forks a project-path branch named after
          // the feature once it has auto-named — no worktree, no pre-send git op.
          branchSetup = { kind: "project_branch", base: choice.base };
        } else {
          // Worktree-provisioning modes persist their settings before send so
          // the backend's `ensure_worktree` reads them. A failure throws + aborts.
          await saveWorktreeChoice({ choice, featureId, setFeatureSetting });
          branchSetup = { kind: "worktree" };
        }
      }
      controls.ws.sendPrompt(text, {
        attachments,
        branchSetup,
        claudeProfile: claudeProfile ?? claudeProfileForPrompt(controls),
      });
    },
    [
      checkoutMutateAsync,
      controls.activeProviderId,
      controls.claudeProfile.selectedClaudeProfile,
      controls.selectedBranch,
      controls.worktreeMode,
      controls.ws,
      data.defaultBranch,
      data.session?.blocks?.length,
      featureId,
      projectId,
      queryClient,
      setFeatureSetting,
    ],
  );
}
