import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import { useGetFeaturePrd, useListProjects, useGetStats } from "@/api/generated";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { FeatureTerminalTab, type FeatureTerminalTabHandle } from "@/components/FeatureTerminalTab";
import { FeatureGitTab } from "@/components/FeatureGitTab";
import { FeatureLayoutShell } from "@/components/feature-layout/FeatureLayoutShell";
import { FeatureLayoutProvider } from "@/components/feature-layout/FeatureLayoutContext";
import { GitBadge } from "@/components/feature-layout/GitBadge";
import type { FeatureTabs } from "@/components/feature-layout/types";
import { AGENT_LABELS } from "@/components/agent-session";
import { WorkflowAgentGrid } from "@/components/WorkflowAgentGrid";
import {
  AlertTriangleIcon,
  BotIcon,
  CheckCircle2Icon,
  CodeIcon,
  GitCompareArrowsIcon,
  Loader2Icon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import { AGENT_ICONS } from "@/components/agent-icons";
import { Button } from "@/components/ui/button";
import { QueueSidebar } from "@/components/QueueSidebar";
import { PlanInputView } from "@/components/PlanInputView";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { NextStepsBar } from "@/components/NextStepsBar";
import { DiffViewerModal } from "@/components/diff/DiffViewerModal";
import type { FeatureSession } from "@/hooks/useFeatureAgentState";
import { normalizeContextWindow, type ContextUsageState } from "@/types/agent";
import { useResolvedModel } from "@/hooks/useResolvedModel";
import { useTerminalStore } from "@/hooks/useTerminalState";
import {
  findLeafById,
  isTabVisible,
  selectFeatureLayout,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";
import { ROOT_LEAF_ID, type TabKind } from "@/stores/feature-layout-schema";
import { useSaveLastOpenedFeature } from "@/hooks/useSaveLastOpenedFeature";
import { useWorkflowKeyboard } from "@/hooks/useWorkflowKeyboard";
import {
  CodeBlockActionsContext,
  type CodeBlockActions,
} from "@/components/CodeBlockActionsContext";
import { cn } from "@/lib/utils";
import { useWsWorkflowBackend } from "@/hooks/useWsWorkflowBackend";
import type { FeatureStatus } from "@/hooks/useFeatureState";

const FeatureEditorTab = lazy(() => import("@/components/editor/FeatureEditorTab"));
import type { FeatureEditorTabHandle } from "@/components/editor/FeatureEditorTab";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";
import { ReconnectIndicator } from "@/components/ReconnectIndicator";

interface FeatureWorkflowViewProps {
  featureId: number;
  projectId: number;
  feature:
    | {
        id: number;
        title: string;
        status: string;
        type: string;
        project_id: number;
        created_at: string;
      }
    | undefined;
  featureQuery: { refetch: () => unknown };
  initialDescription?: string;
}

/** Wraps the body in FeatureLayoutProvider so `useWorkflowKeyboard` can scope shortcuts to the active tab. */
export function FeatureWorkflowView(props: FeatureWorkflowViewProps) {
  return (
    <FeatureLayoutProvider featureId={props.featureId}>
      <FeatureWorkflowViewBody {...props} />
    </FeatureLayoutProvider>
  );
}

function FeatureWorkflowViewBody({
  featureId,
  projectId,
  feature,
  featureQuery: _featureQuery,
  initialDescription,
}: FeatureWorkflowViewProps) {
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const descriptionRef = useRef(description);
  descriptionRef.current = description;

  const { data: prdData } = useGetFeaturePrd(featureId);

  // ---- Unified backend ----
  const backend = useWsWorkflowBackend(
    featureId,
    projectId,
    feature?.status as FeatureStatus | undefined,
  );

  const contextUsageMap = useMemo(() => {
    const map = new Map<number, ContextUsageState>();
    for (const s of backend.sessionEntries) {
      map.set(s.sessionDbId, {
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        contextWindow: normalizeContextWindow(s.contextWindow),
        wasCompacted: s.wasCompacted,
      });
    }
    return map;
  }, [backend.sessionEntries]);

  // Slash commands
  const projectsQuery = useListProjects();
  const projectPath = projectsQuery.data?.find((p) => p.id === projectId)?.path;
  const slashCommands = useWorkflowStore((s) => s.slashCommands);
  const slashCommandsLoading = useWorkflowStore((s) => s.slashCommandsLoading);
  const requestSlashCommands = useWorkflowStore((s) => s.requestSlashCommands);
  const wsReady = useWorkflowStore((s) => s.conn?.isOpen() ?? false);

  // --- Runtime settings for inline provider/model switcher ---
  const {
    resolveModel: resolveModelForAgent,
    handleModelChange: handleModelChangeForAgent,
    resolveProvider: resolveProviderForAgent,
    handleProviderChange: handleProviderChangeForAgent,
    resolveModelThinkingEffort: resolveModelThinkingEffortForAgent,
    setModelThinkingEffort: setModelThinkingEffortForAgent,
  } = useResolvedModel(featureId, projectId);
  const slashCommandProviderId = resolveProviderForAgent("session");

  useEffect(() => {
    if (wsReady && projectPath) {
      requestSlashCommands(projectPath, slashCommandProviderId);
    }
  }, [wsReady, projectPath, requestSlashCommands, slashCommandProviderId]);

  const [deleteTarget, setDeleteTarget] = useState<FeatureSession | null>(null);

  const handleDeleteAgent = useCallback((entry: FeatureSession) => {
    if (!entry.sessionDbId) return;
    setDeleteTarget(entry);
  }, []);

  const confirmDelete = useCallback(() => {
    if (deleteTarget?.sessionDbId) {
      backend.deleteSession(deleteTarget.sessionDbId);
    }
    setDeleteTarget(null);
  }, [backend, deleteTarget]);

  // --- Maximized agent state ---
  const [maximizedAgent, setMaximizedAgent] = useState<string | null>(null);

  // Auto-clear maximize when the maximized agent finishes
  useEffect(() => {
    if (!maximizedAgent) return;
    const entry = backend.sessionEntries.find((e) => {
      const key = `${e.agentType}-${e.sessionDbId}`;
      return key === maximizedAgent;
    });
    if (entry && entry.status !== "running" && entry.status !== "paused") {
      setMaximizedAgent(null);
    }
  }, [maximizedAgent, backend.sessionEntries]);

  // --- Inline diff viewer modal state ---
  const [inlineDiffOpen, setInlineDiffOpen] = useState(false);
  const [diffOriginAgent, setDiffOriginAgent] = useState<FeatureSession | null>(null);
  const handleViewDiffForAgent = useCallback((entry: FeatureSession) => {
    setDiffOriginAgent(entry);
    setInlineDiffOpen(true);
  }, []);
  const handleDiffOpenChange = useCallback((open: boolean) => {
    setInlineDiffOpen(open);
    if (!open) setDiffOriginAgent(null);
  }, []);
  const sendCommentsToOriginAgent = useMemo(
    () =>
      diffOriginAgent
        ? (message: string) => backend.sendToAgent(diffOriginAgent, message)
        : undefined,
    [diffOriginAgent, backend],
  );

  const view = backend.view;
  const actions = backend.actions;

  // Auto-start workflow when navigated from new-workflow page with a description
  const autoStartedRef = useRef(false);
  const { startPlan } = backend;
  useEffect(() => {
    if (autoStartedRef.current || !initialDescription || !wsReady || !feature) return;
    if (view === "plan-input") {
      autoStartedRef.current = true;
      startPlan(initialDescription);
    }
  }, [initialDescription, wsReady, feature, view, startPlan]);

  const agentsWithQuestions = backend.sessionEntries.filter(
    (e) => e.pendingQuestions && e.pendingQuestions.length > 0,
  ).length;

  // Tab state — sourced from the new layout store; the root pane's active tab
  // doubles as "the visible tab" for `useSaveLastOpenedFeature`.
  const layoutState = useFeatureLayoutStore(selectFeatureLayout(featureId));
  const rootLeaf = findLeafById(layoutState.splitRoot, ROOT_LEAF_ID);
  const rootActiveTabId: TabKind = rootLeaf?.activeTabId ?? "agent";
  const agentVisible = isTabVisible(layoutState, "agent");
  const focusedLeaf = layoutState.focusedPaneId
    ? findLeafById(layoutState.splitRoot, layoutState.focusedPaneId)
    : null;
  const {
    agentRefs: _agentRefs,
    setAgentRef,
    sessionPromptTrigger,
  } = useWorkflowKeyboard(backend, openAgent, setOpenAgent, handleViewDiffForAgent, {
    agentLetterFocusEnabled: focusedLeaf
      ? focusedLeaf.activeTabId === "agent"
      : rootActiveTabId === "agent",
  });
  useSaveLastOpenedFeature(projectId, featureId, rootActiveTabId);
  const editorTabRef = useRef<FeatureEditorTabHandle>(null);

  const setPaneActiveTab = useFeatureLayoutStore((s) => s.setPaneActiveTab);

  const startReviewFixerFromGit = useCallback(
    (comments: string) => {
      // Auto-focus of newly-started agents is handled by `useWorkflowKeyboard`.
      backend.startReviewFixer(comments);
      setPaneActiveTab(featureId, ROOT_LEAF_ID, "agent");
    },
    [backend, featureId, setPaneActiveTab],
  );

  // Git stats for tab bar badge
  const { data: gitStats } = useGetStats(
    { feature_id: featureId, mode: "branch" },
    { query: { refetchInterval: 5 * 60 * 1000 } },
  );

  // Terminal state
  const sendToTerminalStore = useTerminalStore((s) => s.sendToTerminal);
  const terminalTabRef = useRef<FeatureTerminalTabHandle>(null);
  const handleTerminalActivate = useCallback(() => {
    requestAnimationFrame(() => terminalTabRef.current?.activate());
  }, []);
  const handleEditorActivate = useCallback(() => {
    requestAnimationFrame(() => editorTabRef.current?.focusActiveEditor());
  }, []);
  const codeBlockActions = useMemo<CodeBlockActions>(
    () => ({ sendToTerminal: (cmd) => sendToTerminalStore(featureId, cmd) }),
    [sendToTerminalStore, featureId],
  );

  const agentTabContent = (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
        {view === "loading" && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {view === "plan-input" && (
          <div className="flex-1 flex items-center justify-center overflow-auto p-6">
            <PlanInputView
              featureId={featureId}
              projectId={projectId}
              onStartPlanning={(text, images) => {
                descriptionRef.current = text;
                setDescription(text);
                backend.startPlan(text || prdData?.prd || "", images);
              }}
              onStartPrd={(text, images) => {
                descriptionRef.current = text;
                setDescription(text);
                backend.startPrd(text || prdData?.prd || "", images);
              }}
              isStartingPlan={backend.isStartingPlan}
              isStartingPrd={backend.isStartingPrd}
              agentTabActive={agentVisible}
            />
          </div>
        )}

        {!backend.hasAnyAgentOutput &&
          backend.sessionEntries.length === 0 &&
          !backend.isStartingWorkflowSession &&
          view === "agents-active" && (
            <div className="flex-1 flex items-center justify-center">
              <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

        {(backend.sessionEntries.length > 0 ||
          actions.canStartBuild ||
          actions.canStartRisk ||
          actions.canStartReview ||
          actions.canStartRetro) && (
          <div
            className={cn(
              "flex-1 min-h-0 px-6 py-2",
              maximizedAgent ? "flex flex-col overflow-hidden" : "overflow-y-auto space-y-2",
            )}
          >
            <WorkflowAgentGrid
              backend={backend}
              featureId={featureId}
              projectId={projectId}
              agentVisible={agentVisible}
              openAgent={openAgent}
              setOpenAgent={setOpenAgent}
              maximizedAgent={maximizedAgent}
              setMaximizedAgent={setMaximizedAgent}
              setAgentRef={setAgentRef}
              agentsWithQuestions={agentsWithQuestions}
              contextUsageMap={contextUsageMap}
              resolveModel={resolveModelForAgent}
              resolveProvider={resolveProviderForAgent}
              handleModelChange={handleModelChangeForAgent}
              handleProviderChange={handleProviderChangeForAgent}
              resolveModelThinkingEffort={resolveModelThinkingEffortForAgent}
              setModelThinkingEffort={setModelThinkingEffortForAgent}
              handleDeleteAgent={handleDeleteAgent}
              onViewDiff={handleViewDiffForAgent}
              slashCommands={slashCommands}
              slashCommandsLoading={slashCommandsLoading}
            />

            {!maximizedAgent &&
              actions.canStartPlan &&
              backend.noAgentsRunning &&
              !backend.planSession?.resumable && (
                <div className="shrink-0 flex py-4">
                  <Button
                    size="lg"
                    onClick={() => backend.startPlan(descriptionRef.current || prdData?.prd || "")}
                    disabled={backend.isStartingPlan}
                    className="gap-2"
                  >
                    {backend.isStartingPlan ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <AGENT_ICONS.plan className="size-4" />
                    )}
                    Generate Plan
                  </Button>
                </div>
              )}

            {!maximizedAgent && (
              <div className="shrink-0">
                <NextStepsBar
                  show={
                    backend.noAgentsRunning &&
                    (actions.canStartBuild ||
                      actions.canStartRisk ||
                      actions.canStartReview ||
                      actions.canStartWorkflowSession ||
                      backend.canContinueBuild ||
                      backend.executeStatus !== "running" ||
                      actions.canStartRetro)
                  }
                  canStartBuild={actions.canStartBuild}
                  canStartRisk={actions.canStartRisk}
                  canStartReview={actions.canStartReview}
                  executeStatus={backend.executeStatus}
                  onStartBuilding={() => backend.startBuilding()}
                  onStartRisk={() => backend.startRisk()}
                  onStartReview={() => backend.startReview()}
                  isStartingExecute={backend.isStartingExecute}
                  isStartingRisk={backend.isStartingRisk}
                  isStartingReview={backend.isStartingReview}
                  canContinueBuild={backend.canContinueBuild}
                  onContinueBuild={() => backend.continueWorkflow()}
                  isContinuingBuild={backend.isContinuingBuild}
                  nextStepNumber={backend.executeWaitingNextStep}
                  canStartWorkflowSession={actions.canStartWorkflowSession}
                  onStartWorkflowSession={(prompt, images) => {
                    backend.startSession(
                      prompt,
                      images?.map((i: { base64: string }) => i.base64),
                    );
                  }}
                  isStartingWorkflowSession={backend.isStartingWorkflowSession}
                  noExecuteAgentRunning={backend.executeStatus !== "running"}
                  projectId={projectId}
                  featureId={featureId}
                  featureType={feature?.type}
                  canStartRefine={actions.canStartRefine}
                  onStartRefinePlan={(description, images) => {
                    backend.startRefine(
                      description,
                      images?.map((i: { base64: string }) => i.base64),
                    );
                  }}
                  isStartingRefinePlan={backend.isStartingRefinePlan}
                  openSessionPrompt={sessionPromptTrigger}
                  canStartRetro={actions.canStartRetro}
                  onStartRetro={() => backend.startRetro()}
                  isStartingRetro={backend.isStartingRetro}
                  agentTabActive={agentVisible}
                />
              </div>
            )}

            {!maximizedAgent && view === "done" && (
              <div className="shrink-0 flex items-center gap-3 pt-4">
                <CheckCircle2Icon className="size-8 text-green-600" />
                <div>
                  <h2 className="text-lg font-semibold">Feature Complete</h2>
                  <p className="text-sm text-muted-foreground">
                    This feature has been reviewed and marked as done.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {backend.error && (
          <div className="shrink-0 mx-6 mt-4 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangleIcon className="size-4 shrink-0" />
            <span className="flex-1">{backend.error}</span>
            <button
              onClick={backend.clearError}
              className="shrink-0 rounded p-0.5 hover:bg-destructive/20 transition-colors"
              aria-label="Dismiss error"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      <QueueSidebar
        queue={backend.queue ?? []}
        featureId={featureId}
        selectedItemId={backend.selectedItemId ?? null}
        onSelectItem={backend.selectItem ?? (() => {})}
        onRetryItem={backend.retryItem}
        onSkipItem={backend.skipItem}
      />
    </div>
  );

  const tabs: FeatureTabs = {
    agent: {
      label: "Agent",
      Icon: BotIcon,
      shortcut: ["cmd", "shift", "A"],
      content: agentTabContent,
    },
    terminal: {
      label: "Terminal",
      Icon: TerminalIcon,
      shortcut: ["cmd", "shift", "T"],
      content: (
        <FeatureTerminalTab ref={terminalTabRef} featureId={featureId} projectId={projectId} />
      ),
    },
    git: {
      label: "Git",
      Icon: GitCompareArrowsIcon,
      shortcut: ["cmd", "shift", "G"],
      badge: <GitBadge gitStats={gitStats} gitBranch={backend.worktreeBranch} />,
      content: (
        <FeatureGitTab
          featureId={featureId}
          diffMode="branch"
          onStartReviewFixer={startReviewFixerFromGit}
        />
      ),
    },
    editor: {
      label: "Editor",
      Icon: CodeIcon,
      shortcut: ["cmd", "shift", "E"],
      content: projectPath ? (
        <Suspense fallback={null}>
          <FeatureEditorTab
            ref={editorTabRef}
            featureId={featureId}
            projectId={projectId}
            projectPath={projectPath}
          />
        </Suspense>
      ) : null,
    },
  };

  return (
    <CodeBlockActionsContext.Provider value={codeBlockActions}>
      <div className="relative flex h-full flex-col">
        <ReconnectIndicator />
        <FeatureTopBar
          featureId={featureId}
          projectId={projectId}
          wsWorktreeStatus={backend.worktreeStatus}
          wsWorktreeBranch={backend.worktreeBranch}
          wsWorktreeSetupOutput={backend.worktreeSetupOutput}
        />
        <FeatureLayoutShell
          featureId={featureId}
          tabs={tabs}
          onTerminalActivate={handleTerminalActivate}
          onEditorActivate={handleEditorActivate}
        />

        {/* Per-agent diff modal (CMD+D) — separate from Git tab */}
        <DiffViewerModal
          featureId={featureId}
          open={inlineDiffOpen}
          onOpenChange={handleDiffOpenChange}
          onSendComments={sendCommentsToOriginAgent}
        />

        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title="Remove agent"
          description={`Remove "${deleteTarget ? (AGENT_LABELS[deleteTarget.agentType] ?? deleteTarget.agentType) : ""}" agent? This will delete its messages.`}
          confirmText="Remove"
          variant="destructive"
          onConfirm={confirmDelete}
        />
      </div>
    </CodeBlockActionsContext.Provider>
  );
}
