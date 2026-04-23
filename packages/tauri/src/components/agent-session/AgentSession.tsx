/**
 * Unified agent UI component for all agent types.
 *
 * When `collapsible` is true, renders with a header and toggle (for workflow
 * view where multiple agents show).  When false, renders full-screen (for
 * standalone session view).
 */

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useImperativeHandle,
  forwardRef,
  memo,
} from "react";
import { useGetWorkspaceSetting } from "@/api/generated";
import { DEFAULT_PROVIDER } from "@/shared/models";
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
import { MetaBar } from "./MetaBar";
import { CollapsibleHeader } from "./CollapsibleHeader";
import { getLatestUserPromptText } from "./getLatestUserPromptText";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AgentSession = memo(
  forwardRef<AgentSessionHandle, AgentSessionProps>(function AgentSession(props, ref) {
    const {
      agentType,
      blocks,
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
    } = props;

    const promptBarRef = useRef<AgentPromptBarHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);

    const loaderStyleSetting = useGetWorkspaceSetting(LOADER_STYLE_KEY);
    const agentCatalog = useAgentCatalog();
    const cwdQuery = useGetFeatureWorkingDir(featureId ?? 0, projectId ?? 0, {
      enabled: featureId != null && projectId != null,
    });
    const projectPath = cwdQuery.data?.path ?? undefined;
    const loaderStyle = parseLoaderStyle(loaderStyleSetting.data?.value);
    // Per-agent components read per-agent state. The global `featureTurnStates`
    // summary is a sidebar-level question ("any agent busy in this feature?");
    // mixing scopes created dual-source bugs where the header showed
    // "In Progress" next to a visible Resume button.
    const isStreaming = status === "running";
    const shouldShowStreamingIndicator = loaderStyle !== "usage-glow";

    // ---- Collapsible state ----
    const [internalOpen, setInternalOpen] = useState(true);
    const isControlled = controlledOpen !== undefined;
    const isOpen = isControlled ? controlledOpen : internalOpen;

    const {
      scrollContainerRef,
      contentRef,
      autoScrollEnabled,
      isLoadingOlder,
      setAutoScrollEnabled,
    } = useAgentSessionScroll({
      isOpen,
      blocks,
      hasMore,
      onLoadOlder,
    });

    // Auto-open when agent starts running (uncontrolled mode only)
    useEffect(() => {
      if ((status === "running" || status === "paused") && !isControlled) {
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
      selectableProviders,
      supportedThinkingEfforts,
    } = useAgentSessionModelState({
      agentCatalog: agentCatalog.data,
      currentProviderId,
      currentModelId,
      runtimeProvider,
      onProviderChange,
      blocksLength: blocks.length,
      status,
    });
    const emptyStateMessage = collapsible ? "No output yet" : "Send a message to start a session.";
    const planFeedbackDefault = useMemo(
      () => (pendingPlanApproval ? getLatestUserPromptText(blocks) : ""),
      [blocks, pendingPlanApproval],
    );

    const handleCycleModel = useCallback(() => {
      if (!onModelChange) return;
      if (canChangeProvider && selectableProviders.length > 0) {
        const cycleEntries = selectableProviders.flatMap((provider) => [
          { type: "provider" as const, providerId: provider.id },
          ...provider.models.map((model) => ({
            type: "model" as const,
            providerId: provider.id,
            modelId: model.id,
          })),
        ]);

        const currentIndex = cycleEntries.findIndex(
          (entry) =>
            entry.type === "model" &&
            entry.providerId === activeProviderId &&
            entry.modelId === currentModelId,
        );
        const next = cycleEntries[(currentIndex + 1 + cycleEntries.length) % cycleEntries.length];
        if (next.type === "provider") {
          onProviderChange?.(next.providerId);
          const nextProvider = selectableProviders.find(
            (provider) => provider.id === next.providerId,
          );
          const nextModel = nextProvider?.models[0];
          if (nextModel) onModelChange(nextModel.id);
          return;
        }
        onProviderChange?.(next.providerId);
        onModelChange(next.modelId);
        return;
      }

      if (visibleModels.length === 0) return;
      const idx = visibleModels.findIndex((m) => m.id === currentModelId);
      const next = visibleModels[(idx + 1 + visibleModels.length) % visibleModels.length];
      onModelChange(next.id);
    }, [
      activeProviderId,
      canChangeProvider,
      currentModelId,
      onModelChange,
      onProviderChange,
      selectableProviders,
      visibleModels,
    ]);

    const showWorktreeChip = !!onToggleWorktree && blocks.length === 0 && status === "idle";
    const showAutoScrollChip = !!shouldShowPromptBar;
    const hasMeta =
      showAutoScrollChip ||
      !!onPermissionModeToggle ||
      !!onModelChange ||
      showDiffBar ||
      (todos && todos.length > 0) ||
      !!runtimeSessionId ||
      showWorktreeChip;

    // ---- Shared sub-sections ----
    const metaBar = hasMeta ? (
      <MetaBar
        showAutoScrollChip={showAutoScrollChip}
        autoScrollEnabled={autoScrollEnabled}
        onToggleAutoScroll={() => setAutoScrollEnabled(!autoScrollEnabled)}
        permissionMode={permissionMode}
        onPermissionModeToggle={onPermissionModeToggle}
        showWorktreeChip={showWorktreeChip}
        useWorktree={useWorktree}
        onToggleWorktree={onToggleWorktree}
        onProviderChange={onProviderChange}
        currentProviderId={activeProviderId}
        onModelChange={onModelChange}
        currentThinkingEffort={parseThinkingEffort(currentThinkingEffort)}
        supportedThinkingEfforts={supportedThinkingEfforts}
        onThinkingEffortChange={onThinkingEffortChange}
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
        isRunning={status === "running"}
        onPause={onStop}
      />
    ) : null;

    const streamContent = (
      <>
        {isIdle && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">{emptyStateMessage}</p>
          </div>
        )}
        {isLoadingOlder && (
          <div className="flex justify-center py-2">
            <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {blocks.length > 0 && (
          <AgentStream
            blocks={blocks}
            isStreaming={isStreaming}
            showStreamingIndicator={shouldShowStreamingIndicator}
            basePath={projectPath}
          />
        )}
      </>
    );

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
        onCycleModel={onModelChange ? handleCycleModel : undefined}
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

    const bottomSection = (
      <div className="shrink-0">
        {metaBar}
        {promptBar}
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
          <div
            ref={scrollContainerRef}
            className={cn("flex-1 overflow-auto px-4 pt-4 pb-8", isIdle && "flex")}
            style={{ overflowAnchor: "none" }}
          >
            <div
              ref={contentRef}
              className={cn(isIdle && "flex min-h-full flex-1 items-center justify-center")}
            >
              {streamContent}
            </div>
          </div>
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
          promptBarRef={promptBarRef}
        />

        {isOpen && (
          <>
            <div
              ref={scrollContainerRef}
              className="flex-1 min-h-0 border-t border-border/30 overflow-y-auto pb-6"
              style={{ overflowAnchor: "none" }}
            >
              <div ref={contentRef}>
                {blocks.length === 0 && status === "idle" ? (
                  <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
                    {emptyStateMessage}
                  </div>
                ) : (
                  <>
                    {isLoadingOlder && (
                      <div className="flex justify-center py-2">
                        <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    <AgentStream
                      blocks={blocks}
                      isStreaming={isStreaming}
                      showStreamingIndicator={shouldShowStreamingIndicator}
                      basePath={projectPath}
                    />
                  </>
                )}
              </div>
            </div>

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
