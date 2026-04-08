import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditorStore } from "@/stores/editor-store";
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
import type { FeatureSession } from "@/hooks/useFeatureAgentState";
import type { ContextUsageState } from "@/types/agent";
import { useResolvedModel } from "@/hooks/useResolvedModel";
import type { AgentType } from "@/types/agent-types";
import { phaseModelKey } from "@/shared/models";
import { useTerminalStore } from "@/hooks/useTerminalState";
import { useActiveTab } from "@/hooks/useActiveTab";
import { useSaveLastOpenedFeature } from "@/hooks/useSaveLastOpenedFeature";
import { useWorkflowKeyboard } from "@/hooks/useWorkflowKeyboard";
import { CodeBlockActionsContext, type CodeBlockActions } from "@/components/CodeBlockActionsContext";
import { cn } from "@/lib/utils";
import { useWsWorkflowBackend } from "@/hooks/useWsWorkflowBackend";
import type { FeatureStatus } from "@/hooks/useFeatureState";

const FeatureEditorTab = lazy(() => import("@/components/editor/FeatureEditorTab"));
import type { FeatureEditorTabHandle } from "@/components/editor/FeatureEditorTab";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";
import { WorkflowQueueSidebar } from "@/components/workflow/WorkflowQueueSidebar";
import { PhaseApprovalBar } from "@/components/workflow/PhaseApprovalBar";
import { WorkflowInputBar } from "@/components/workflow/WorkflowInputBar";
import {
  useGetWorkflowDefinition,
  useGetFeatureSettings,
  getGetFeatureSettingsQueryKey,
  useSetFeatureSetting,
} from "@/api/generated";

export function FeatureWorkflowView({
  featureId,
  projectId,
  feature,
  featureQuery: _featureQuery,
  initialDescription,
  initialUseWorktree,
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
        workflow_definition_id?: number | null;
      }
    | undefined;
  featureQuery: { refetch: () => unknown };
  initialDescription?: string;
  initialUseWorktree?: boolean;
}) {
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const descriptionRef = useRef(description);
  descriptionRef.current = description;

  const { data: prdData } = useGetFeaturePrd(featureId);
  const { data: workflowDefinition } = useGetWorkflowDefinition(
    feature?.workflow_definition_id ?? 0,
    { enabled: !!feature?.workflow_definition_id },
  );

  // ---- Unified backend ----
  const backend = useWsWorkflowBackend(
    featureId,
    projectId,
    feature?.status as FeatureStatus | undefined,
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
  const isCustomWorkflow = !!feature?.workflow_definition_id;
  const pendingApproval = useWorkflowStore((s) => s.pendingApproval);
  const approvePhase = useWorkflowStore((s) => s.approvePhase);
  const startCustomWorkflow = useWorkflowStore((s) => s.startCustomWorkflow);
  const phaseStates = useWorkflowStore((s) => s.phaseStates);
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

  // --- Phase-aware model resolution for ws-workflow ---
  const queryClient = useQueryClient();
  const { data: featureSettingsData } = useGetFeatureSettings(featureId);
  const phaseSettingsMap = useMemo(() => {
    if (!featureSettingsData) return {};
    return Object.fromEntries(featureSettingsData.map((s) => [s.key, s.value]));
  }, [featureSettingsData]);

  const phasesBySlug = useMemo(() => {
    if (!workflowDefinition) return new Map<string, { model_override: string }>();
    return new Map(workflowDefinition.phases.map((p) => [p.slug, p]));
  }, [workflowDefinition]);

  const setPhaseModelSetting = useSetFeatureSetting({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetFeatureSettingsQueryKey(featureId) }),
  });

  // Merged model resolver: phase override → definition default → agent-type cascade
  const resolveModelForAgent = useCallback(
    (agentType: AgentType): string => {
      if (isCustomWorkflow) {
        const phase = phasesBySlug.get(agentType);
        if (phase) {
          const featureVal = phaseSettingsMap[phaseModelKey(agentType)];
          if (featureVal) return featureVal;
          if (phase.model_override) return phase.model_override;
        }
      }
      return resolveModel(agentType);
    },
    [isCustomWorkflow, phasesBySlug, phaseSettingsMap, resolveModel],
  );

  const handleModelChangeForAgent = useCallback(
    (agentType: AgentType, modelId: string) => {
      if (isCustomWorkflow && phasesBySlug.has(agentType)) {
        setPhaseModelSetting.mutate({ featureId, key: phaseModelKey(agentType), value: modelId });
      } else {
        handleModelChange(agentType, modelId);
      }
    },
    [isCustomWorkflow, phasesBySlug, featureId, setPhaseModelSetting, handleModelChange],
  );

  const [isStartingCustom, setIsStartingCustom] = useState(false);

  const handleStartCustomWorkflow = useCallback(
    (description: string) => {
      if (!feature?.workflow_definition_id || !feature.title) return;
      setIsStartingCustom(true);
      startCustomWorkflow(featureId, projectId, feature.title, feature.workflow_definition_id, description);
      // Reset after a short delay — backend will update state via WS
      setTimeout(() => setIsStartingCustom(false), 2000);
    },
    [feature, featureId, projectId, startCustomWorkflow],
  );

  // Derive custom workflow phase info for manual gate messaging
  const readyManualPhase = useMemo(() => {
    if (!isCustomWorkflow) return null;
    for (const [slug, state] of phaseStates) {
      if (state.status === "ready") {
        const phase = workflowDefinition?.phases?.find((p) => p.slug === slug);
        if (phase?.gate_type === "manual") return phase;
      }
    }
    return null;
  }, [isCustomWorkflow, phaseStates, workflowDefinition?.phases]);

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

  const { agentRefs: _agentRefs, setAgentRef, sessionPromptTrigger } = useWorkflowKeyboard(
    backend, openAgent, setOpenAgent, handleViewDiffForAgent,
  );

  const view = backend.view;
  const actions = backend.actions;

  // Auto-start workflow when navigated from new-workflow page with a description
  const autoStartedRef = useRef(false);
  const { startPlan } = backend;
  useEffect(() => {
    if (autoStartedRef.current || !initialDescription || !wsReady || !feature) return;
    if (isCustomWorkflow && feature.workflow_definition_id) {
      autoStartedRef.current = true;
      setIsStartingCustom(true);
      startCustomWorkflow(featureId, projectId, feature.title, feature.workflow_definition_id, initialDescription, initialUseWorktree);
      setTimeout(() => setIsStartingCustom(false), 2000);
    } else if (!isCustomWorkflow && view === "plan-input") {
      autoStartedRef.current = true;
      startPlan(initialDescription);
    }
  }, [initialDescription, initialUseWorktree, wsReady, isCustomWorkflow, feature, featureId, projectId, startCustomWorkflow, view, startPlan]);

  const agentsWithQuestions = backend.sessionEntries.filter(
    (e) => e.pendingQuestions && e.pendingQuestions.length > 0,
  ).length;

  // Tab state
  const { activeTab, setActiveTab } = useActiveTab(featureId);

  // Open artifact in editor tab
  const openArtifact = useEditorStore((s) => s.openArtifact);
  const openPhaseArtifacts = useEditorStore((s) => s.openPhaseArtifacts);
  const editorActivePaneId = useEditorStore((s) => s.features[featureId]?.activePaneId ?? "main");
  const handleViewArtifact = useCallback((phaseSlug: string, artifactTypes?: string[]) => {
    if (artifactTypes && artifactTypes.length > 0) {
      openPhaseArtifacts(featureId, editorActivePaneId, phaseSlug, artifactTypes);
    } else {
      openArtifact(featureId, editorActivePaneId, phaseSlug);
    }
    setActiveTab("editor");
  }, [featureId, openArtifact, openPhaseArtifacts, editorActivePaneId, setActiveTab]);
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

  return (
    <CodeBlockActionsContext.Provider value={codeBlockActions}>
    <div className="relative flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} wsWorktreeStatus={backend.worktreeStatus} wsWorktreeBranch={backend.worktreeBranch} wsWorktreeSetupOutput={backend.worktreeSetupOutput} />
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

            {view === "plan-input" && !isCustomWorkflow && (
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

            {/* Auto-start loading — shown while auto-naming and worktree setup are in progress */}
            {initialDescription && isCustomWorkflow && view === "plan-input" && (
              <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Setting up workflow...</p>
                </div>
              </div>
            )}

            {/* Custom workflow: manual gate ready message */}
            {isCustomWorkflow && readyManualPhase && backend.noAgentsRunning && backend.sessionEntries.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Phase &apos;{readyManualPhase.name}&apos; is ready. Click Start to begin.
                  </p>
                </div>
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
                  resolveModel={resolveModelForAgent}
                  handleModelChange={handleModelChangeForAgent}
                  handleDeleteAgent={handleDeleteAgent}
                  onViewDiff={handleViewDiffForAgent}
                  slashCommands={slashCommands}
                  slashCommandsLoading={slashCommandsLoading}
                />

                {!maximizedAgent && actions.canStartPlan && backend.noAgentsRunning && !backend.planSession?.resumable && (
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

                {/* Phase approval bar for custom workflow phases */}
                {!maximizedAgent && pendingApproval && (() => {
                  const phaseName = workflowDefinition?.phases?.find(
                    (p) => p.slug === pendingApproval.phaseSlug,
                  )?.name ?? pendingApproval.phaseSlug;
                  return (
                    <PhaseApprovalBar
                      phaseName={phaseName}
                      artifactContent={pendingApproval.artifactContent}
                      onApprove={() => approvePhase(pendingApproval.phaseSlug, true)}
                      onReject={(fb) => approvePhase(pendingApproval.phaseSlug, false, fb)}
                    />
                  );
                })()}

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

          {feature?.workflow_definition_id ? (
            <WorkflowQueueSidebar
              workflowDefinitionId={feature.workflow_definition_id}
              featureId={featureId}
              onViewArtifact={handleViewArtifact}
            />
          ) : (
            <QueueSidebar
              queue={backend.queue ?? []}
              featureId={featureId}
              selectedItemId={backend.selectedItemId ?? null}
              onSelectItem={backend.selectItem ?? (() => {})}
              onRetryItem={backend.retryItem}
              onSkipItem={backend.skipItem}
            />
          )}
        </div>
      </div>
      </div>


      {/* Custom workflow input bar — shown when no phases have started yet (hidden during auto-start) */}
      {isCustomWorkflow && view === "plan-input" && !pendingApproval && workflowDefinition && !initialDescription && (
        <WorkflowInputBar
          onStart={handleStartCustomWorkflow}
          isStarting={isStartingCustom}
          workflowName={workflowDefinition.name}
        />
      )}

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
