/**
 * Unified agent UI component for all agent types.
 *
 * When `collapsible` is true, renders with a header and toggle (for workflow
 * view where multiple agents show).  When false, renders full-screen (for
 * standalone session view).
 */

import { useState, useEffect, useMemo, useRef, useImperativeHandle, forwardRef, memo } from "react";
import { useGetWorkspaceSetting } from "@/api/generated";
import { parseThinkingEffort } from "@/shared/thinking-effort";
import { LOADER_STYLE_KEY, parseLoaderStyle } from "@/lib/loader-style";
import { cn, capitalize } from "@/lib/utils";
import { Loader2Icon } from "lucide-react";
import { AgentStream } from "../AgentStream";
import { AgentPromptBar, type AgentPromptBarHandle } from "../AgentPromptBar";
import { ContextUsageBar } from "../ContextUsageBar";
import { AGENT_ICONS } from "../agent-icons";
import { useGetFeatureWorkingDir } from "../../api/generated";
import { useAgentCatalog } from "../../api/agentRuntime";
import { normalizeContextWindow } from "@/types/agent";
import { AGENT_LABELS, STATUS_BADGE } from "./constants";
import type { AgentSessionProps, AgentSessionHandle } from "./types";
import { shallowEqualSkipFunctions } from "./shallowEqualSkipFunctions";
import { useAgentSessionScroll } from "./useAgentSessionScroll";
import { useAgentSessionModelState } from "./useAgentSessionModelState";
import { MetaBar, type MetaBarHandle } from "./MetaBar";
import { MetaBarSecondary } from "./MetaBarSecondary";
import { useNarrowContainer } from "./useNarrowContainer";
import { CollapsibleHeader } from "./CollapsibleHeader";
import { getLatestUserPromptText } from "./getLatestUserPromptText";
import { useAutoScrollShortcut } from "./useAutoScrollShortcut";

/**
 * Container width below which the auto-scroll, todos, and info chips slide
 * out of the inline `MetaBar` and into a `MetaBarSecondary` strip rendered
 * below the prompt. Picked to match the point at which the inline bar starts
 * clipping when the model picker + mode + worktree + review chips are all
 * visible.
 */
const META_BAR_COMPACT_THRESHOLD_PX = 640;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AgentSession = memo(
  forwardRef<AgentSessionHandle, AgentSessionProps>(function AgentSession(props, ref) {
    const {
      agentType,
      blocks,
      rootBlocks,
      toolResultMap,
      status,
      onSend,
      onStop,
      pendingQuestions,
      onAnswerSubmit,
      disableShortcuts,
      label,
      icon,
      collapsible = false,
      className,
      resumable,
      onResume,
      disabled,
      open: controlledOpen,
      onToggle,
      navAgentIndex,
      hasFileChanges,
      onViewDiff,
      canDelete,
      onDelete,
      todos,
      permissionMode,
      onPermissionModeToggle,
      enabledOptInModes,
      pendingPlanApproval,
      planApproveLabel,
      planApprovalError,
      onPlanApprove,
      onPlanRequestChanges,
      onPlanReject,
      contextUsage,
      currentProviderId,
      onProviderChange,
      currentModelId,
      onModelChange,
      currentThinkingEffort,
      showReadOnlyModel,
      onThinkingEffortChange,
      featureId,
      projectId,
      sessionId,
      wsSessionId,
      initialDraft,
      pendingPermission,
      onPermissionDecision,
      onMarkDone,
      maximized,
      onToggleMaximize,
      runtimeProvider,
      runtimeSessionId,
      slashCommandsOverride,
      slashCommandsLoading,
      hasMore,
      onLoadOlder,
      useWorktree,
      onToggleWorktree,
      worktreeProjectId,
      worktreeDefaultBranch,
      worktreeSelectedBranch,
      onWorktreeBranchChange,
      agentTabActive = true,
    } = props;

    const promptBarRef = useRef<AgentPromptBarHandle>(null);
    const metaBarRef = useRef<MetaBarHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);

    const loaderStyleSetting = useGetWorkspaceSetting(LOADER_STYLE_KEY);
    const agentCatalog = useAgentCatalog();
    const cwdQuery = useGetFeatureWorkingDir(
      featureId ?? 0,
      { project_id: projectId ?? 0 },
      { query: { enabled: featureId != null && projectId != null } },
    );
    const projectPath = cwdQuery.data?.path ?? undefined;
    const loaderStyle = parseLoaderStyle(loaderStyleSetting.data?.value);
    // Per-agent components read per-agent state. The global `featureTurnStates`
    // summary is a sidebar-level question ("any agent busy in this feature?");
    // mixing scopes created dual-source bugs where the header showed
    // "In Progress" next to a visible Resume button.
    const isStreaming = status === "agent";
    const shouldShowStreamingIndicator = loaderStyle !== "usage-glow";

    // ---- Collapsible state ----
    const [internalOpen, setInternalOpen] = useState(true);
    const isControlled = controlledOpen !== undefined;
    const isOpen = isControlled ? controlledOpen : internalOpen;

    const {
      scrollContainerRef,
      topSentinelRef,
      scrollContentRef,
      autoScrollEnabled,
      isLoadingOlder,
      scrollToBottom,
    } = useAgentSessionScroll({
      blocks,
      conversationKey: wsSessionId ?? null,
      hasMore,
      onLoadOlder,
    });

    useAutoScrollShortcut({
      enabled: agentTabActive && !disableShortcuts,
      onEnableAutoScroll: scrollToBottom,
    });

    // Auto-open when agent starts running (uncontrolled mode only)
    useEffect(() => {
      if (status !== "idle" && !isControlled) {
        setInternalOpen(true);
      }
    }, [status, isControlled]);

    useImperativeHandle(
      ref,
      () => ({
        focusPromptBar: () => promptBarRef.current?.focusInput(),
        focusActiveInput: () => {
          const container = containerRef.current;
          const permBtn = container?.querySelector<HTMLElement>("[data-permission-area] button");
          if (permBtn) {
            permBtn.scrollIntoView({ block: "nearest" });
            permBtn.focus();
            return;
          }
          const questionEl = container?.querySelector<HTMLElement>(
            "[data-question-area] button, [data-question-area] input",
          );
          if (questionEl) {
            questionEl.scrollIntoView({ block: "nearest" });
            questionEl.focus();
            return;
          }
          const editable = container?.querySelector<HTMLElement>(
            '[contenteditable="true"], textarea',
          );
          if (editable) {
            editable.scrollIntoView({ block: "nearest" });
            editable.focus();
            return;
          }
          if (headerRef.current) {
            headerRef.current.scrollIntoView({ block: "nearest" });
            headerRef.current.focus();
          }
        },
        isOpen,
      }),
      [isOpen],
    );

    const handleToggle = () => {
      if (onToggle) onToggle();
      else setInternalOpen((prev) => !prev);
    };

    const handleCollapse = () => {
      handleToggle();
      requestAnimationFrame(() => headerRef.current?.focus());
    };

    const isIdle = status === "idle" && blocks.length === 0;
    const badge = STATUS_BADGE[status];
    const IconComponent = icon ?? AGENT_ICONS[agentType] ?? Loader2Icon;
    const displayLabel = label ?? AGENT_LABELS[agentType] ?? capitalize(agentType);

    const shouldShowPromptBar = (() => {
      if (!collapsible) return true;
      if (pendingPlanApproval) return true;
      return (
        status !== "idle" || blocks.length > 0 || (pendingQuestions && pendingQuestions.length > 0)
      );
    })();

    const showDiffBar = !!(hasFileChanges && onViewDiff);
    const {
      providerOptions,
      activeProviderId,
      visibleModels,
      currentModelLabel,
      canChangeProvider,
      supportedThinkingEfforts,
    } = useAgentSessionModelState({
      agentCatalog: agentCatalog.data,
      currentProviderId,
      currentModelId,
      runtimeProvider,
      onProviderChange,
      hasConversation: blocks.length > 0,
    });
    const emptyStateMessage = collapsible ? "No output yet" : "Send a message to start a session.";
    // Hot-path short-circuit: `pendingPlanApproval` is null in the common
    // case, so we don't want `getLatestUserPromptText(blocks)` (an O(N)
    // reverse scan) to recompute on every streamed chunk just because
    // `blocks` changed. Gate the deps on whether plan approval is pending —
    // when it isn't, `blocks` drops out of the dep list entirely.
    const blocksForPlanFeedback = pendingPlanApproval ? blocks : null;
    const planFeedbackDefault = useMemo(
      () => (pendingPlanApproval && blocksForPlanFeedback ? getLatestUserPromptText(blocks) : ""),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: skip recompute when no plan approval is pending
      [blocksForPlanFeedback, pendingPlanApproval],
    );

    // Same gate as `canChangeProvider` — see useAgentSessionModelState.
    // Either the legacy on/off toggle is wired (`onToggleWorktree`) or the
    // richer two-chip group is (toggle + branch picker + projectId).
    const showWorktreeChip = blocks.length === 0 && !!onToggleWorktree;
    const showAutoScrollChip = !!shouldShowPromptBar;

    const isNarrow = useNarrowContainer(containerRef, META_BAR_COMPACT_THRESHOLD_PX);

    // When narrow, secondary chips render below the prompt — so they don't
    // count toward whether the inline `MetaBar` should appear above it.
    const hasInlineMeta =
      !!onPermissionModeToggle ||
      !!onModelChange ||
      !!showReadOnlyModel ||
      showDiffBar ||
      showWorktreeChip;
    const hasSecondaryMeta =
      showAutoScrollChip || (todos && todos.length > 0) || !!(runtimeSessionId && onStop);
    const hasMeta = hasInlineMeta || (hasSecondaryMeta && !isNarrow);

    // ---- Shared sub-sections ----
    const metaBar = hasMeta ? (
      <MetaBar
        ref={metaBarRef}
        secondaryBelow={isNarrow}
        showAutoScrollChip={showAutoScrollChip}
        autoScrollEnabled={autoScrollEnabled}
        onToggleAutoScroll={scrollToBottom}
        permissionMode={permissionMode}
        onPermissionModeToggle={onPermissionModeToggle}
        enabledOptInModes={enabledOptInModes}
        showWorktreeChip={showWorktreeChip}
        useWorktree={useWorktree}
        onToggleWorktree={onToggleWorktree}
        worktreeProjectId={worktreeProjectId}
        worktreeDefaultBranch={worktreeDefaultBranch}
        worktreeSelectedBranch={worktreeSelectedBranch}
        onWorktreeBranchChange={onWorktreeBranchChange}
        onProviderChange={onProviderChange}
        currentProviderId={activeProviderId}
        onModelChange={onModelChange}
        currentThinkingEffort={parseThinkingEffort(currentThinkingEffort)}
        supportedThinkingEfforts={supportedThinkingEfforts}
        onThinkingEffortChange={onThinkingEffortChange}
        showReadOnlyModel={showReadOnlyModel}
        currentModelId={currentModelId}
        currentModelLabel={currentModelLabel}
        models={visibleModels}
        providers={
          canChangeProvider
            ? providerOptions
            : providerOptions.filter((provider) => provider.id === activeProviderId)
        }
        canChangeProvider={canChangeProvider}
        showDiffBar={showDiffBar}
        onViewDiff={onViewDiff}
        todos={todos}
        runtimeProvider={runtimeProvider}
        runtimeSessionId={runtimeSessionId}
        projectPath={projectPath}
        isRunning={status === "agent"}
        onPause={onStop}
        onModelSelected={() => promptBarRef.current?.focusInput()}
      />
    ) : null;

    const streamContent =
      blocks.length > 0 ? (
        <AgentStream
          blocks={blocks}
          rootBlocks={rootBlocks}
          toolResultMap={toolResultMap}
          isStreaming={isStreaming}
          showStreamingIndicator={shouldShowStreamingIndicator}
          basePath={projectPath}
          scrollContainerRef={scrollContainerRef}
          topSentinelRef={topSentinelRef}
          scrollContentRef={scrollContentRef}
          isLoadingOlder={isLoadingOlder}
        />
      ) : null;

    const promptBar = shouldShowPromptBar ? (
      <AgentPromptBar
        ref={promptBarRef}
        onSend={onSend}
        onStop={onStop}
        status={status}
        disabled={disabled}
        pendingQuestions={pendingQuestions}
        onQuestionResponse={onAnswerSubmit}
        disableShortcuts={disableShortcuts}
        onCollapse={collapsible ? handleCollapse : undefined}
        permissionMode={permissionMode}
        onPermissionModeToggle={onPermissionModeToggle}
        pendingPlanApproval={pendingPlanApproval}
        planFeedbackDefault={planFeedbackDefault}
        planApproveLabel={planApproveLabel}
        planApprovalError={planApprovalError}
        onPlanApprove={onPlanApprove}
        onPlanRequestChanges={onPlanRequestChanges}
        onPlanReject={onPlanReject}
        onOpenModelPicker={onModelChange ? () => metaBarRef.current?.openModelPicker() : undefined}
        agentTabActive={agentTabActive}
        featureId={featureId}
        projectId={projectId}
        sessionId={sessionId}
        wsSessionId={wsSessionId}
        initialDraft={initialDraft}
        onToggleMaximize={onToggleMaximize}
        noTopPadding={!!hasMeta}
        slashCommandsOverride={slashCommandsOverride}
        slashCommandsLoading={slashCommandsLoading}
        pendingPermission={pendingPermission}
        onPermissionDecision={onPermissionDecision}
      />
    ) : null;

    const secondaryBar =
      isNarrow && hasSecondaryMeta && shouldShowPromptBar ? (
        <MetaBarSecondary
          showAutoScrollChip={showAutoScrollChip}
          autoScrollEnabled={autoScrollEnabled}
          onToggleAutoScroll={scrollToBottom}
          todos={todos}
          runtimeProvider={runtimeProvider}
          runtimeSessionId={runtimeSessionId}
          projectPath={projectPath}
          isRunning={status === "agent"}
          onPause={onStop}
        />
      ) : null;

    const bottomSection = (
      <div className="shrink-0">
        {metaBar}
        {promptBar}
        {secondaryBar}
        {normalizeContextWindow(contextUsage?.contextWindow) != null && (
          <div className="flex items-center gap-2 px-3 pb-1.5 pt-0">
            <ContextUsageBar
              usage={contextUsage}
              className="flex-1 px-0 py-0"
              loaderStyle={loaderStyle}
              isStreaming={isStreaming}
            />
          </div>
        )}
      </div>
    );

    // ==== Full-screen mode ====
    if (!collapsible) {
      return (
        <div ref={containerRef} className={cn("flex h-full flex-col", className)}>
          {isIdle ? (
            <div className="flex flex-1 items-center justify-center px-4 pt-4 pb-8">
              <p className="text-sm text-muted-foreground">{emptyStateMessage}</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 px-4 pt-4 pb-8">{streamContent}</div>
          )}
          {bottomSection}
        </div>
      );
    }

    // ==== Collapsible mode ====
    return (
      <div
        ref={containerRef}
        className={cn(
          "flex flex-col rounded-lg border border-border bg-background",
          isOpen && maximized && "flex-1 min-h-0",
          isOpen && !maximized && "h-[60vh] min-h-0 shrink-0 overflow-hidden",
          !isOpen && "shrink-0",
          className,
        )}
        {...(navAgentIndex != null ? { "data-agent-container": navAgentIndex } : {})}
      >
        <CollapsibleHeader
          headerRef={headerRef}
          onToggle={handleToggle}
          isOpen={isOpen}
          IconComponent={IconComponent}
          badge={badge}
          displayLabel={displayLabel}
          navAgentIndex={navAgentIndex}
          onMarkDone={onMarkDone}
          resumable={resumable}
          onResume={onResume}
          canDelete={canDelete}
          onDelete={onDelete}
          maximized={maximized}
          onToggleMaximize={onToggleMaximize}
        />

        {isOpen && (
          <>
            {blocks.length === 0 && status === "idle" ? (
              <div className="flex flex-1 items-center justify-center border-t border-border/30 p-6 text-sm text-muted-foreground">
                {emptyStateMessage}
              </div>
            ) : (
              <div className="flex-1 min-h-0 border-t border-border/30 px-3 pb-6">
                {streamContent}
              </div>
            )}

            <div className="shrink-0">
              {!hasMeta && (
                <div
                  className="pointer-events-none h-16 -mt-16"
                  style={{
                    background:
                      "linear-gradient(to bottom, transparent 0%, hsl(var(--background) / 0.7) 8%, hsl(var(--background) / 0.9) 20%, hsl(var(--background)) 40%)",
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
                    maskImage: "linear-gradient(to bottom, transparent 0%, black 25%)",
                    WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 25%)",
                  }}
                />
              )}
              {metaBar}
              {promptBar}
              {secondaryBar}
              {contextUsage && (
                <div className="flex items-center gap-2 px-3 pb-1.5 pt-0">
                  <ContextUsageBar
                    usage={contextUsage}
                    className="flex-1 px-0 py-0"
                    loaderStyle={loaderStyle}
                    isStreaming={isStreaming}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }),
  shallowEqualSkipFunctions,
);
