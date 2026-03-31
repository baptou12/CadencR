import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import { useGetFeaturePrd, useListProjects, useGetStats } from "@/api/generated";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { FeatureTabBar } from "@/components/FeatureTabBar";
import type { FeatureTab } from "@/hooks/useActiveTab";
import { FeatureTerminalTab, type FeatureTerminalTabHandle } from "@/components/FeatureTerminalTab";
import { FeatureGitTab } from "@/components/FeatureGitTab";
import { AGENT_LABELS } from "@/components/AgentSession";
import { WorkflowAgentGrid } from "@/components/WorkflowAgentGrid";
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon, XIcon } from "lucide-react";
import { AGENT_ICONS } from "@/components/agent-icons";
import { Button } from "@/components/ui/button";
import { QueueSidebar } from "@/components/QueueSidebar";
import { PlanInputView } from "@/components/PlanInputView";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { NextStepsBar } from "@/components/NextStepsBar";
import { DiffViewerModal } from "@/components/diff/DiffViewerModal";
import { WorktreeSetupSection } from "@/components/WorktreeSetupSection";
import type { FeatureSession } from "@/hooks/useFeatureAgentState";
import type { ContextUsageState } from "@/types/agent";
import { useResolvedModel } from "@/hooks/useResolvedModel";
import { useTerminalStore } from "@/hooks/useTerminalState";
import { useActiveTab } from "@/hooks/useActiveTab";
import { useSaveLastOpenedFeature } from "@/hooks/useSaveLastOpenedFeature";
import { useWorkflowKeyboard } from "@/hooks/useWorkflowKeyboard";
import { CodeBlockActionsContext, type CodeBlockActions } from "@/components/CodeBlockActionsContext";
import { cn } from "@/lib/utils";
import { useWsWorkflowBackend } from "@/hooks/useWsWorkflowBackend";

const FeatureEditorTab = lazy(() => import("@/components/editor/FeatureEditorTab"));
import type { FeatureEditorTabHandle } from "@/components/editor/FeatureEditorTab";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";

export function FeatureWorkflowView({
  featureId,
  projectId,
  feature,
  featureQuery: _featureQuery,
}: {
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
}) {
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const descriptionRef = useRef(description);
  descriptionRef.current = description;

  const { data: prdData } = useGetFeaturePrd(featureId);

  // ---- Unified backend ----
  const backend = useWsWorkflowBackend(
    featureId,
    projectId,
  );

  const contextUsageMap = useMemo(() => {
    const map = new Map<number, ContextUsageState>();
    for (const s of backend.sessionEntries) {
      const total = s.inputTokens + s.outputTokens;
      map.set(s.sessionDbId, {
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        totalTokens: total,
        contextWindow: s.contextWindow,
        usageRatio: Math.min(1, s.contextWindow > 0 ? total / s.contextWindow : 0),
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
  const wsReady = useWorkflowStore((s) => s.ws?.readyState === WebSocket.OPEN);

  useEffect(() => {
    if (wsReady && projectPath) {
      requestSlashCommands(projectPath);
    }
  }, [wsReady, projectPath, requestSlashCommands]);

  // --- Model settings for inline model switcher ---
  const { resolveModel, handleModelChange } = useResolvedModel(
    featureId,
    projectId,
  );

  const [deleteTarget, setDeleteTarget] = useState<FeatureSession | null>(null);

  const handleDeleteAgent = useCallback(
    (entry: FeatureSession) => {
      if (!entry.sessionDbId) return;
      setDeleteTarget(entry);
    },
    [],
  );

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
  const handleViewDiffForAgent = useCallback(() => {
    setInlineDiffOpen(true);
  }, []);

  const { agentRefs, setAgentRef, sessionPromptTrigger } = useWorkflowKeyboard(
    backend, openAgent, setOpenAgent, handleViewDiffForAgent,
  );

  const view = backend.view;
  const actions = backend.actions;

  const agentsWithQuestions = backend.sessionEntries.filter(
    (e) => e.pendingQuestions && e.pendingQuestions.length > 0,
  ).length;

  // Tab state
  const { activeTab, setActiveTab } = useActiveTab(featureId);
  useSaveLastOpenedFeature(projectId, featureId, activeTab);
  const editorTabRef = useRef<FeatureEditorTabHandle>(null);

  const handleTabChange = useCallback((tab: FeatureTab) => {
    if (activeTab === "editor" && tab !== "editor" && editorTabRef.current) {
      editorTabRef.current.requestLeave(() => setActiveTab(tab));
    } else {
      setActiveTab(tab);
    }
  }, [activeTab, setActiveTab]);

  // Git stats for tab bar badge
  const { data: gitStats } = useGetStats(
    { featureId, mode: "branch" },
    { refetchInterval: 5 * 60 * 1000 },
  );

  // Terminal state
  const sendToTerminalStore = useTerminalStore((s) => s.sendToTerminal);
  const terminalTabRef = useRef<FeatureTerminalTabHandle>(null);
  const handleTerminalActivate = useCallback(() => {
    requestAnimationFrame(() => terminalTabRef.current?.activate());
  }, []);
  const codeBlockActions = useMemo<CodeBlockActions>(
    () => ({ sendToTerminal: (cmd) => sendToTerminalStore(featureId, cmd) }),
    [sendToTerminalStore, featureId],
  );

  // Auto-load conversation history for agents that are already open (paused/running)
  // but have empty blocks — e.g. after app restart.
  const sessionCount = backend.sessionEntries.length;
  const { loadAgentHistory } = backend;
  useEffect(() => {
    if (!loadAgentHistory || sessionCount === 0) return;
    for (const entry of backend.sessionEntries) {
      if (
        (entry.status === "paused" || entry.status === "running") &&
        entry.blocks.length === 0
      ) {
        loadAgentHistory(entry);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCount, loadAgentHistory, featureId]);

  return (
    <CodeBlockActionsContext.Provider value={codeBlockActions}>
    <div className="relative flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} />
      <FeatureTabBar activeTab={activeTab} featureId={featureId} onTabChange={handleTabChange} gitStats={gitStats} gitBranch={backend.worktreeBranch} onTerminalActivate={handleTerminalActivate} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Terminal tab — stays mounted to preserve PTY */}
        <FeatureTerminalTab ref={terminalTabRef} featureId={featureId} projectId={projectId} hidden={activeTab !== "terminal"} />

        {/* Editor tab — stays mounted to preserve state */}
        <div className={cn("h-full", activeTab !== "editor" && "hidden")}>
          {projectPath && (
            <Suspense fallback={null}>
              <FeatureEditorTab ref={editorTabRef} featureId={featureId} projectPath={projectPath} />
            </Suspense>
          )}
        </div>

        {/* Git tab */}
        {activeTab === "git" && (
          <FeatureGitTab
            featureId={featureId}
            diffMode="branch"
            onStartReviewFixer={(comments) => backend.startReviewFixer(comments)}
          />
        )}

        {/* Agent tab */}
        <div className={cn("h-full", activeTab !== "agent" && "hidden")}>
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
                />
              </div>
            )}

            {view !== "plan-input" && view !== "loading" && !maximizedAgent && (
              <div className="shrink-0 px-6 pt-6">
                <WorktreeSetupSection
                  featureId={featureId}
                  projectId={projectId}
                  wsWorktreeStatus={backend.worktreeStatus}
                  wsWorktreeBranch={backend.worktreeBranch}
                  wsWorktreeSetupOutput={backend.worktreeSetupOutput}
                />
              </div>
            )}

            {!backend.hasAnyAgentOutput && backend.sessionEntries.length === 0 &&
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
              <div className={cn("flex-1 min-h-0 px-6 py-2", maximizedAgent ? "flex flex-col overflow-hidden" : "overflow-y-auto space-y-2")}>
                <WorkflowAgentGrid
                  backend={backend}
                  featureId={featureId}
                  projectId={projectId}
                  openAgent={openAgent}
                  setOpenAgent={setOpenAgent}
                  maximizedAgent={maximizedAgent}
                  setMaximizedAgent={setMaximizedAgent}
                  setAgentRef={setAgentRef}
                  agentsWithQuestions={agentsWithQuestions}
                  contextUsageMap={contextUsageMap}
                  resolveModel={resolveModel}
                  handleModelChange={handleModelChange}
                  handleDeleteAgent={handleDeleteAgent}
                  onViewDiff={handleViewDiffForAgent}
                  slashCommands={slashCommands}
                  slashCommandsLoading={slashCommandsLoading}
                />

                {!maximizedAgent && actions.canStartPlan && backend.noAgentsRunning && (
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
                        backend.startSession(prompt, images?.map((i: { base64: string }) => i.base64));
                      }}
                      isStartingWorkflowSession={backend.isStartingWorkflowSession}
                      noExecuteAgentRunning={backend.executeStatus !== "running"}
                      projectId={projectId}
                      featureId={featureId}
                      featureType={feature?.type}
                      canStartRefine={actions.canStartRefine}
                      onStartRefinePlan={(description, images) => {
                        backend.startRefine(description, images?.map((i: { base64: string }) => i.base64));
                      }}
                      isStartingRefinePlan={backend.isStartingRefinePlan}
                      openSessionPrompt={sessionPromptTrigger}
                      canStartRetro={actions.canStartRetro}
                      onStartRetro={() => backend.startRetro()}
                      isStartingRetro={backend.isStartingRetro}
                    />
                  </div>
                )}

                {!maximizedAgent && view === "done" && (
                  <div className="shrink-0 flex items-center gap-3 pt-4">
                    <CheckCircle2Icon className="size-8 text-green-600" />
                    <div>
                      <h2 className="text-lg font-semibold">
                        Feature Complete
                      </h2>
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
      </div>
      </div>

      {/* Per-agent diff modal (CMD+D) — separate from Git tab */}
      <DiffViewerModal
        featureId={featureId}
        open={inlineDiffOpen}
        onOpenChange={setInlineDiffOpen}
        onStartReviewFixer={(comments) => backend.startReviewFixer(comments)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
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
