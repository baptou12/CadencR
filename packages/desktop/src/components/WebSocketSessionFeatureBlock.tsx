import { useCallback, useState, type ReactElement } from "react";
import { DiffViewerModal } from "@/components/diff/DiffViewerModal";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { FeatureLayoutProvider } from "@/components/feature-layout/FeatureLayoutContext";
import { FeatureLayoutShell } from "@/components/feature-layout/FeatureLayoutShell";
import { useSaveLastOpenedFeature } from "@/hooks/useSaveLastOpenedFeature";
import { ROOT_LEAF_ID, type TabKind } from "@/stores/feature-layout-schema";
import {
  getFocusedTab,
  isTabVisible,
  selectFeatureLayout,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";
import {
  useSessionControls,
  useSessionFeatureData,
  useSessionRefs,
  useWsSessionEffects,
  useWsSessionShortcuts,
} from "@/components/WebSocketSessionFeatureBlockHooks";
import { useSessionTabs } from "@/components/WebSocketSessionFeatureBlockTabs";

export interface WebSocketSessionFeatureBlockProps {
  sessionId: string;
  cwd: string;
  featureId: number;
  projectId: number;
  layoutFeatureId?: number;
  embedded?: boolean;
  hotkeysEnabled?: boolean;
  onActivate?: () => void;
  projectName?: string;
  featureTitle?: string;
  featureLabel?: string | null;
  lastActivityAt?: string | null;
  isPinned?: boolean;
  isPinPending?: boolean;
  onTogglePin?: () => void;
}

export function WebSocketSessionFeatureBlock(
  props: WebSocketSessionFeatureBlockProps,
): ReactElement {
  const layoutFeatureId = props.layoutFeatureId ?? props.featureId;
  return (
    <FeatureLayoutProvider
      featureId={layoutFeatureId}
      hotkeysEnabled={props.hotkeysEnabled ?? true}
    >
      <WebSocketSessionFeatureBody {...props} layoutFeatureId={layoutFeatureId} />
    </FeatureLayoutProvider>
  );
}

function WebSocketSessionFeatureBody(
  props: WebSocketSessionFeatureBlockProps & { layoutFeatureId: number },
): ReactElement {
  const {
    sessionId,
    cwd,
    featureId,
    projectId,
    layoutFeatureId,
    embedded = false,
    hotkeysEnabled = true,
    onActivate,
  } = props;
  const layoutState = useFeatureLayoutStore(selectFeatureLayout(layoutFeatureId));
  const focusedTabId = getFocusedTab(layoutState) ?? "agent";
  useSaveLastOpenedFeature(projectId, featureId, focusedTabId, embedded);

  const gitVisible = isTabVisible(layoutState, "git");
  const data = useSessionFeatureData(sessionId, cwd, featureId, projectId, {
    gitMetadataEnabled: !embedded || gitVisible,
    projectLookupEnabled: !embedded,
  });
  const controls = useSessionControls(sessionId, featureId, projectId, cwd, data.featureSettings, {
    loadPersistedState: !embedded,
  });
  const refs = useSessionRefs();
  const [inlineDiffOpen, setInlineDiffOpen] = useState(false);

  const { handleViewDiff, sendPromptAndFocus, sendFromGitTab } = useSessionFeatureActions({
    layoutFeatureId,
    controls,
    refs,
    setInlineDiffOpen,
  });

  useWsSessionEffects({
    sessionId,
    cwd,
    featureId,
    data,
    controls,
    refs,
    focusedTabId,
    hotkeysEnabled,
    autoFocusPrompt: !embedded,
    autoInitSession: !embedded,
  });
  useWsSessionShortcuts({ controls, setInlineDiffOpen, hotkeysEnabled });

  const tabs = useFeatureBlockTabs({
    sessionId,
    featureId,
    projectId,
    data,
    controls,
    refs,
    layoutState,
    hotkeysEnabled,
    handleViewDiff,
    sendFromGitTab,
  });

  return (
    <section
      tabIndex={0}
      onFocusCapture={onActivate}
      onPointerDownCapture={onActivate}
      className="flex h-full min-h-0 flex-col outline-none"
    >
      <SessionFeatureTopBar
        featureId={featureId}
        projectId={projectId}
        embedded={embedded}
        data={data}
        projectName={props.projectName}
        featureTitle={props.featureTitle}
        featureLabel={props.featureLabel}
        lastActivityAt={props.lastActivityAt}
        isPinned={props.isPinned}
        isPinPending={props.isPinPending}
        onTogglePin={props.onTogglePin}
      />
      <FeatureLayoutShell
        featureId={layoutFeatureId}
        tabs={tabs}
        splitsEnabled={!embedded}
        hotkeysEnabled={hotkeysEnabled}
        mountInactiveTabs={!embedded}
        onTerminalActivate={() => requestAnimationFrame(() => refs.terminal.current?.activate())}
        onEditorActivate={() =>
          requestAnimationFrame(() => refs.editor.current?.focusActiveEditor())
        }
      />
      <DiffViewerModal
        featureId={featureId}
        open={inlineDiffOpen}
        onOpenChange={setInlineDiffOpen}
        onSendComments={sendPromptAndFocus}
      />
    </section>
  );
}

function useFeatureBlockTabs(args: {
  sessionId: string;
  featureId: number;
  projectId: number;
  data: ReturnType<typeof useSessionFeatureData>;
  controls: ReturnType<typeof useSessionControls>;
  refs: ReturnType<typeof useSessionRefs>;
  layoutState: Parameters<typeof isTabVisible>[0];
  hotkeysEnabled: boolean;
  handleViewDiff: () => void;
  sendFromGitTab: (message: string) => void;
}): ReturnType<typeof useSessionTabs> {
  return useSessionTabs({
    sessionId: args.sessionId,
    featureId: args.featureId,
    projectId: args.projectId,
    data: args.data,
    controls: args.controls,
    refs: args.refs,
    agentVisible: isTabVisible(args.layoutState, "agent"),
    hotkeysEnabled: args.hotkeysEnabled,
    handleViewDiff: args.handleViewDiff,
    sendFromGitTab: args.sendFromGitTab,
  });
}

function useSessionFeatureActions({
  layoutFeatureId,
  controls,
  refs,
  setInlineDiffOpen,
}: {
  layoutFeatureId: number;
  controls: ReturnType<typeof useSessionControls>;
  refs: ReturnType<typeof useSessionRefs>;
  setInlineDiffOpen: (open: boolean) => void;
}): {
  handleViewDiff: () => void;
  sendPromptAndFocus: (message: string) => void;
  sendFromGitTab: (message: string) => void;
} {
  const setPaneActiveTab = useFeatureLayoutStore((s) => s.setPaneActiveTab);
  const setRootActive = useCallback(
    (tab: TabKind): void => setPaneActiveTab(layoutFeatureId, ROOT_LEAF_ID, tab),
    [layoutFeatureId, setPaneActiveTab],
  );
  const handleViewDiff = useCallback((): void => setInlineDiffOpen(true), [setInlineDiffOpen]);
  const sendPromptAndFocus = useCallback(
    (message: string): void => {
      controls.ws.sendPrompt(message);
      requestAnimationFrame(() => refs.agent.current?.focusPromptBar());
    },
    [controls.ws, refs.agent],
  );
  const sendFromGitTab = useCallback(
    (message: string): void => {
      sendPromptAndFocus(message);
      setRootActive("agent");
    },
    [sendPromptAndFocus, setRootActive],
  );
  return { handleViewDiff, sendPromptAndFocus, sendFromGitTab };
}

interface SessionFeatureTopBarProps {
  featureId: number;
  projectId: number;
  embedded: boolean;
  data: ReturnType<typeof useSessionFeatureData>;
  projectName?: string;
  featureTitle?: string;
  featureLabel?: string | null;
  lastActivityAt?: string | null;
  isPinned?: boolean;
  isPinPending?: boolean;
  onTogglePin?: () => void;
}

function SessionFeatureTopBar({
  featureId,
  projectId,
  embedded,
  data,
  projectName,
  featureTitle,
  featureLabel,
  lastActivityAt,
  isPinned,
  isPinPending,
  onTogglePin,
}: SessionFeatureTopBarProps): ReactElement {
  return (
    <FeatureTopBar
      featureId={featureId}
      projectId={projectId}
      mode="session"
      className={embedded ? "" : "shrink-0"}
      wsWorktreeStatus={embedded ? data.worktreeStatus : data.session?.worktreeStatus}
      wsWorktreeBranch={embedded ? data.worktreeBranch : data.session?.worktreeBranch}
      wsWorktreeSetupOutput={data.session?.worktreeSetupOutput}
      wsWorktreeError={data.session?.worktreeError}
      onRetryWorktreeSetup={data.handleRetryWorktreeSetup}
      showCustomActions={!embedded}
      showSidebarChrome={!embedded}
      draggable={!embedded}
      projectName={projectName}
      titleOverride={featureTitle}
      labelOverride={featureLabel}
      lastActivityAt={lastActivityAt}
      isPinned={isPinned}
      isPinPending={isPinPending}
      onTogglePin={onTogglePin}
      hideEmbeddedWorktreeSetup={embedded}
    />
  );
}
