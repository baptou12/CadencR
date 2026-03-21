/**
 * tRPC workflow backend adapter — implements WorkflowBackend by wrapping
 * the existing useWorkflowAgents + useAgentChat hooks.
 *
 * This is a thin adapter with no logic of its own.
 */

import { useMemo, useRef } from "react";
import { trpc } from "@/trpc";
import { useFeatureAgentState, type FeatureSession } from "@/hooks/useFeatureAgentState";
import { useWorkflowAgents } from "@/hooks/useWorkflowAgents";
import { useAgentChat } from "@/hooks/useAgentChat";
import type { WorkflowStatus } from "@/hooks/useWorkflowWebSocket";
import type { AgentType } from "../../main/agents/types";
import { deriveViewState, type WorkflowBackend, type ViewState } from "@/hooks/workflowBackendTypes";

// ---------------------------------------------------------------------------
// Derive WorkflowStatus from legacy agent statuses
// ---------------------------------------------------------------------------

function deriveLegacyWorkflowStatus(
  wf: ReturnType<typeof useWorkflowAgents>,
): WorkflowStatus {
  const { plan, prd, execute } = wf;

  if (plan.status === "running" || plan.status === "paused") return "planning";
  if (prd.status === "running" || prd.status === "paused") return "prd";

  // Plan completed but not yet building — approval state
  if (
    plan.status === "completed" &&
    execute.status === "idle"
  ) {
    return "plan_approval";
  }

  if (
    execute.status === "running" ||
    execute.status === "paused" ||
    execute.status === "error"
  ) {
    return "building";
  }

  if (execute.status === "completed") return "completed";

  // Nothing started yet
  if (plan.status === "idle" && plan.blocks.length === 0) return "idle";

  // Fallback: if plan has blocks but isn't running, show approval
  if (plan.status === "completed") return "plan_approval";

  return "idle";
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function useTrpcWorkflowBackend(
  featureId: number,
  projectId: number,
): WorkflowBackend {
  const agentState = useFeatureAgentState(featureId);

  // Bridge: startPlan/startPrd receive description as arg, but useWorkflowAgents
  // reads it via getDescription(). We use a ref to pass it through.
  const descriptionRef = useRef("");
  const wf = useWorkflowAgents({
    featureId,
    projectId,
    getDescription: () => descriptionRef.current,
  });
  const chat = useAgentChat({
    featureId,
    projectId,
    refetch: agentState.refetch,
  });

  const startReviewFixerMutation =
    trpc.workflow.startReviewFixer.useMutation();
  const deleteSessionMutation = trpc.sessions.deleteSession.useMutation();

  // -- Derived status --
  const workflowStatus = deriveLegacyWorkflowStatus(wf);

  const planSession = useMemo(
    () => wf.sessionEntries.find((s) => s.agentType === "plan") ?? null,
    [wf.sessionEntries],
  );
  const prdSession = useMemo(
    () => wf.sessionEntries.find((s) => s.agentType === "prd") ?? null,
    [wf.sessionEntries],
  );

  const view: ViewState = deriveViewState(workflowStatus, wf.sessionEntries);

  const isLoading =
    wf.isStartingPlan ||
    wf.isStartingPrd ||
    wf.isStartingExecute ||
    wf.isStartingRisk ||
    wf.isStartingReview ||
    wf.isStartingRetro ||
    wf.isContinuingBuild;

  // Derive action availability from agent statuses
  const actions = useMemo(() => {
    const planDone = wf.plan.status === "completed";
    const execIdle = wf.execute.status === "idle";
    const execDone = wf.execute.status === "completed";
    const execError = wf.execute.status === "error";
    const hasPlan = planDone || wf.plan.blocks.length > 0;
    return {
      canStartPlan: !hasPlan && wf.plan.status === "idle" && (wf.prd.status === "idle" || wf.prd.status === "completed"),
      canStartPrd: !hasPlan && wf.plan.status === "idle" && wf.prd.status === "idle",
      canStartBuild: hasPlan && (execIdle || execError || execDone),
      canStartRisk: hasPlan && wf.risk.status !== "running",
      canStartReview: hasPlan && wf.review.status !== "running" && (wf.execute.status === "running" || execDone || wf.execute.status === "paused"),
      canStartWorkflowSession: hasPlan,
      canStartRefine: hasPlan,
      canStartRetro: execDone,
    };
  }, [wf.plan, wf.prd, wf.execute, wf.risk, wf.review]);

  return {
    // -- Read state --
    workflowStatus,
    sessionEntries: wf.sessionEntries,
    planSession,
    prdSession,
    queue: null,
    autonomyLevel: 3,
    error: null,

    // -- Action availability --
    actions,

    // -- Derived state --
    hasAnyAgentOutput: wf.hasAnyAgentOutput,
    noAgentsRunning: wf.noAgentsRunning,
    view,
    isLoading,

    // -- Loading flags --
    isStartingPlan: wf.isStartingPlan,
    isStartingPrd: wf.isStartingPrd,
    isStartingExecute: wf.isStartingExecute,
    isStartingRisk: wf.isStartingRisk,
    isStartingReview: wf.isStartingReview,
    isStartingRetro: wf.isStartingRetro,
    isContinuingBuild: wf.isContinuingBuild,
    isStartingWorkflowSession: wf.isStartingWorkflowSession,
    isStartingRefinePlan: wf.isStartingRefinePlan,
    canContinueBuild: wf.canContinueBuild,
    executeWaitingNextStep: wf.executeWaitingNextStep,
    executeStatus: wf.execute.status,
    planApprovalError: chat.planApprovalError ?? null,

    // -- Commands --
    startPlan: (description: string, images?: string[]) => {
      descriptionRef.current = description;
      void wf.handleStartPlanning(images as never);
    },
    startPrd: (description: string, images?: string[]) => {
      descriptionRef.current = description;
      void wf.handleStartPrd(images as never);
    },
    approvePlan: (
      subprocessId?: string | null,
      sessionDbId?: number,
      _requestId?: string,
    ) => chat.handlePlanApprove(subprocessId, sessionDbId),
    rejectPlan: (
      feedback: string,
      subprocessId?: string | null,
      sessionDbId?: number,
      _requestId?: string,
    ) => chat.handlePlanRequestChanges(subprocessId, feedback, sessionDbId),
    startBuilding: () => void wf.handleStartBuilding(),
    continueWorkflow: () => void wf.handleContinueBuild(),
    sendToAgent: (entry: FeatureSession, message: string, images?: string[]) => {
      if (entry.agentType === "execute" && entry.subprocessId) {
        void wf.sendToExecuteSubprocess(entry.subprocessId, message, images as never);
      } else {
        void wf.handleAgentSend(entry, message, images as never);
      }
    },
    stopAgent: (entry: FeatureSession) => {
      if (entry.agentType === "execute" && entry.subprocessId) {
        void wf.interruptExecuteSubprocess(entry.subprocessId, entry.sessionDbId);
      } else {
        wf.handleAgentStop(entry);
      }
    },
    interruptAgent: (entry: FeatureSession) => {
      if (entry.subprocessId) {
        void wf.interruptExecuteSubprocess(entry.subprocessId, entry.sessionDbId);
      }
    },
    submitPermission: (
      entry: FeatureSession,
      decision: string,
      feedback?: string,
    ) =>
      chat.handlePermissionDecision(
        entry.subprocessId,
        decision as "allow_once" | "allow_future" | "deny",
        feedback,
      ),
    submitAnswers: (entry: FeatureSession, response: string) =>
      wf.handleSessionQuestionResponse(entry, response),
    startSession: (prompt: string, images?: string[]) =>
      void wf.handleStartWorkflowSession(prompt, images as never),
    startRefine: (description: string, images?: string[]) =>
      void wf.handleStartRefinePlan(description, images as never),
    startRisk: () => void wf.handleStartRisk(),
    startReview: () => void wf.handleStartReview(),
    startRetro: () => void wf.handleStartRetro(),
    startReviewFixer: (comments: string) =>
      startReviewFixerMutation.mutate({
        featureId,
        projectId,
        prompt: comments,
      }),
    markDone: (sessionDbId: number) => wf.handleMarkSessionDone(sessionDbId),
    deleteSession: (sessionDbId: number) =>
      deleteSessionMutation.mutate({ sessionId: sessionDbId }),
    handleResume: (agentType: string, sessionDbId: number) =>
      void wf.handleResume(agentType as AgentType, sessionDbId),

    // -- Queue-specific (not available in legacy) --
    skipItem: undefined,
    retryItem: undefined,
    setAutonomyLevel: undefined,
    selectItem: undefined,
    selectedItemId: undefined,

    // -- Refs/callbacks --
    refetch: agentState.refetch,
  };
}
