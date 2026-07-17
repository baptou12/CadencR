import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { EditorFuzzyShortcut } from "@/components/editor/EditorFuzzyShortcut";
import { promptDropTargetIdOf } from "@/lib/prompt-drop-target";
import { OpenDiffInEditorProvider } from "@/components/diff/OpenDiffInEditorContext";
import { LinkRoutingProvider } from "@/components/links/LinkRoutingProvider";
import { FeatureContentSearchShortcut } from "@/components/FeatureContentSearchShortcut";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { FeatureLayoutProvider } from "@/components/feature-layout/FeatureLayoutContext";
import { FeatureLayoutShell } from "@/components/feature-layout/FeatureLayoutShell";
import type { TabKind } from "@/stores/feature-layout-schema";
import {
  getFocusedTab,
  isTabVisible,
  selectFeatureLayout,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";
import { useRequestedFeatureFocus } from "@/hooks/useRequestedFeatureFocus";
import {
  useSessionControls,
  useSessionFeatureData,
  useSessionRefs,
  useWsSessionEffects,
  useWsSessionShortcuts,
} from "@/components/WebSocketSessionFeatureBlockHooks";
import {
  useAgentFirstNonAgentWork,
  useStaggeredTabReadiness,
} from "@/components/useAgentFirstNonAgentWork";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  focusTabTrigger,
  useAgentDropZone,
  useFeatureBlockTabs,
  useOpenDiffFileInEditor,
  useSessionFeatureActions,
} from "./WebSocketSessionFeatureBlockLocalHooks";

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
  onExclude?: () => void;
  requestedFocusTab?: TabKind;
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
    requestedFocusTab,
  } = props;
  // Phones get the embedded-style single tab strip: splits/resize make no
  // sense at 390px, so we collapse to one pane driven by the top tabs.
  const isMobile = useIsMobile();
  const splitsEnabled = !embedded && !isMobile;
  const layoutState = useFeatureLayoutStore(selectFeatureLayout(layoutFeatureId));
  const requestedFocusPending = useRequestedFeatureFocus(layoutFeatureId, requestedFocusTab);
  const focusedTabId = getFocusedTab(layoutState) ?? "agent";
  // The non-agent tab the user is explicitly looking at (focused in its pane,
  // or requested by a deep-link). It loads the instant the gate opens; the
  // rest stagger in behind it.
  const immediateNonAgentTab: TabKind | null =
    focusedTabId !== "agent"
      ? focusedTabId
      : requestedFocusTab != null && requestedFocusTab !== "agent"
        ? requestedFocusTab
        : null;
  const nonAgentTabRequested = immediateNonAgentTab != null;
  const nonAgentWorkEnabled = useAgentFirstNonAgentWork({
    enabled: !embedded || nonAgentTabRequested,
    immediate: nonAgentTabRequested,
    resetKey: sessionId,
  });
  // Reveal non-agent tab content in priority order (editor → git → terminal →
  // browser) so split layouts don't hydrate every panel in the same frame as
  // the agent stream.
  const tabReady = useStaggeredTabReadiness({
    enabled: nonAgentWorkEnabled,
    immediateTab: immediateNonAgentTab,
    resetKey: sessionId,
  });

  // `useSaveLastOpenedFeature` is mounted once at the route level; we used to
  // also call it here, which produced a duplicate
  // `PUT /api/workspace/settings/lastOpenedFeature` on every open.
  const gitVisible = isTabVisible(layoutState, "git");
  const data = useSessionFeatureData(sessionId, cwd, featureId, projectId, {
    gitMetadataEnabled: nonAgentWorkEnabled && (!embedded || gitVisible),
    projectLookupEnabled: nonAgentWorkEnabled,
  });
  const controls = useSessionControls(sessionId, featureId, projectId, data.effectiveCwd, {
    loadPersistedState: !embedded,
    agentCatalogEnabled: !embedded && nonAgentWorkEnabled,
  });
  const refs = useSessionRefs();
  const requestedFocusKeyRef = useRef<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const openDiffFileInEditor = useOpenDiffFileInEditor({
    featureId,
    layoutFeatureId,
    rootPath: data.effectiveCwd || data.projectPath || cwd,
    refs,
  });

  const { sendFromGitTab } = useSessionFeatureActions({ layoutFeatureId, controls, refs });

  useWsSessionEffects({
    sessionId,
    cwd,
    featureId,
    data,
    controls,
    refs,
    focusedTabId,
    hotkeysEnabled,
    // Phones don't get autofocus: it pops the on-screen keyboard the moment a
    // conversation/agent tab opens, covering the transcript before it's read.
    autoFocusPrompt: !embedded && !requestedFocusPending && !isMobile,
    autoInitSession: !embedded,
  });
  useEffect((): (() => void) | void => {
    if (!requestedFocusTab || requestedFocusPending) return;

    const key = `${layoutFeatureId}:${requestedFocusTab}`;
    if (requestedFocusKeyRef.current === key) return;
    requestedFocusKeyRef.current = key;
    const focusRequestedTarget = (): void => {
      // Phones: never programmatically focus the prompt — it pops the on-screen
      // keyboard over the transcript when a conversation/agent tab opens.
      if (requestedFocusTab === "agent" && !isMobile) refs.agent.current?.focusPromptBar();
      if (requestedFocusTab === "terminal") refs.terminal.current?.activate();
      if (requestedFocusTab === "editor") refs.editor.current?.focusActiveEditor();
      if (requestedFocusTab === "git" && sectionRef.current) {
        focusTabTrigger(sectionRef.current, layoutFeatureId, requestedFocusTab);
      }
    };
    const frame = requestAnimationFrame(focusRequestedTarget);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    layoutFeatureId,
    refs.agent,
    refs.editor,
    refs.terminal,
    requestedFocusTab,
    requestedFocusPending,
    isMobile,
  ]);
  useWsSessionShortcuts({ controls, hotkeysEnabled });

  // The whole feature/card area is the drop zone — drops on history, meta
  // bar, or any tab content route to this agent's prompt. The id must match
  // what `AgentPromptBar` computes so `useImageAttachments` accepts the drop.
  const promptDropTargetId = useMemo(
    () => promptDropTargetIdOf({ wsSessionId: sessionId, featureId }),
    [sessionId, featureId],
  );
  const agentDropZone = useAgentDropZone();

  const tabs = useFeatureBlockTabs({
    sessionId,
    featureId,
    layoutFeatureId,
    projectId,
    data,
    controls,
    refs,
    layoutState,
    tabReady,
    hotkeysEnabled,
    sendFromGitTab,
  });

  return (
    <LinkRoutingProvider scopeId={featureId}>
      <OpenDiffInEditorProvider onOpenFileInEditor={openDiffFileInEditor}>
        <section
          ref={sectionRef}
          tabIndex={0}
          onFocusCapture={onActivate}
          onPointerDownCapture={onActivate}
          // `data-agent-prompt-id` tags this whole agent area as the drop
          // target — the Electron preload walks `closest()` to find it. The
          // `group/agent-section` + `data-agent-dragover` pair lets the prompt
          // bar paint its primary ring via CSS, with no React state crossing
          // component boundaries — so in the unified grid only the card under
          // the cursor highlights, not every mounted prompt.
          data-agent-prompt-id={promptDropTargetId}
          data-agent-dragover={agentDropZone.isDragging ? "true" : undefined}
          // Distinguishes the full-page feature chrome from unified-grid cards
          // so theme CSS (e.g. the CadencR chassis) can style only the former.
          data-feature-chrome={embedded ? "embedded" : "standard"}
          onDragEnter={agentDropZone.onDragEnter}
          onDragLeave={agentDropZone.onDragLeave}
          onDrop={agentDropZone.onDrop}
          className="group/agent-section flex h-full min-h-0 flex-col outline-none"
        >
          {!embedded && (
            <FeatureContentSearchShortcut
              featureId={featureId}
              projectId={projectId}
              layoutFeatureId={layoutFeatureId}
              enabled={hotkeysEnabled}
            />
          )}
          <EditorFuzzyShortcut
            featureId={featureId}
            projectId={projectId}
            enabled={hotkeysEnabled}
          />
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
            onExclude={props.onExclude}
          />
          <FeatureLayoutShell
            featureId={layoutFeatureId}
            tabs={tabs}
            splitsEnabled={splitsEnabled}
            hotkeysEnabled={hotkeysEnabled}
            mountInactiveTabs={false}
            onTerminalActivate={() =>
              requestAnimationFrame(() => refs.terminal.current?.activate())
            }
            onEditorActivate={() =>
              requestAnimationFrame(() => refs.editor.current?.focusActiveEditor())
            }
          />
        </section>
      </OpenDiffInEditorProvider>
    </LinkRoutingProvider>
  );
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
  onExclude?: () => void;
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
  onExclude,
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
      onExclude={onExclude}
      hideEmbeddedWorktreeSetup={embedded}
    />
  );
}
