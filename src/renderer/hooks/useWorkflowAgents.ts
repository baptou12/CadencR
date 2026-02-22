/**
 * Workflow agent orchestration hook — session derivation and state.
 * Mutations live in useWorkflowMutations. UI state (description, openAgent) lives in the component.
 */

import { useMemo, useCallback } from "react";
import { useFeatureAgentState, type FeatureSession } from "@/hooks/useFeatureAgentState";
import { useWorkflowMutations } from "@/hooks/useWorkflowMutations";
import type { AgentType } from "../../main/agents/types";
import type { AgentStatus } from "@/components/AgentSession";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseWorkflowAgentsParams {
  featureId: number;
  projectId: number;
  featureQuery?: { refetch: () => unknown };
  /** Current description text — needed by plan/brainstorm starters */
  getDescription: () => string;
}

/** Re-export for consumers */
export type SessionEntry = FeatureSession;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function statusOf(s: FeatureSession | undefined): AgentStatus {
  return s?.status ?? "idle";
}

function blocksOf(s: FeatureSession | undefined) {
  return s?.blocks ?? [];
}

export function useWorkflowAgents({
  featureId,
  projectId,
  getDescription,
}: UseWorkflowAgentsParams) {
  const { sessions, refetch } = useFeatureAgentState(featureId);

  // --- Mutations (delegated) ---
  const {
    handleQuestionResponse: questionResponse,
    handleContinueBuild: continueBuild,
    handleAddFixPhase: addFixPhase,
    ...mut
  } = useWorkflowMutations({
    featureId,
    projectId,
    sessions,
    refetch,
    getDescription,
  });

  // --- Session entry list for display ---
  const sessionEntries: FeatureSession[] = useMemo(() => {
    return sessions.filter((s) => {
      if (s.agentType === "execute" && s.runId == null && !s.subprocessId) return false;
      if (s.status === "idle" && s.blocks.length === 0) return false;
      return true;
    });
  }, [sessions]);

  // --- Helper: find session by agent type ---
  const findSession = useCallback(
    (agentType: AgentType): FeatureSession | undefined =>
      sessions.find((s) => s.agentType === agentType),
    [sessions],
  );

  // --- Derived state helpers ---
  const planSession = useMemo(() => findSession("plan"), [findSession]);
  const brainstormSession = useMemo(() => findSession("brainstorm"), [findSession]);
  const riskSession = useMemo(() => findSession("risk"), [findSession]);
  const reviewSession = useMemo(() => findSession("review"), [findSession]);

  const executeSessions = useMemo(
    () => sessions.filter((s) => s.agentType === "execute" && s.subprocessId),
    [sessions],
  );

  const hasAnyAgentOutput = sessionEntries.length > 0;
  const noAgentsRunning = sessions.every((s) => s.status !== "running");

  // --- Continue build state ---
  const waitingOrchestrator = useMemo(
    () => sessions.find((s) => s.agentType === "execute" && s.runId == null && s.status === "paused"),
    [sessions],
  );
  const canContinueBuild = waitingOrchestrator != null;

  const executeStatus: AgentStatus = useMemo(() => {
    if (executeSessions.length === 0) {
      if (waitingOrchestrator) return "paused";
      return "idle";
    }
    if (executeSessions.some((s) => s.status === "running")) return "running";
    if (executeSessions.some((s) => s.status === "paused")) return "paused";
    if (executeSessions.some((s) => s.status === "error")) return "error";
    if (executeSessions.every((s) => s.status === "completed")) return "completed";
    return "idle";
  }, [executeSessions, waitingOrchestrator]);

  // Wrap handleContinueBuild to inject the orchestrator session ID
  const handleContinueBuild = useCallback(async () => {
    if (!waitingOrchestrator) return;
    await continueBuild(waitingOrchestrator.sessionDbId);
  }, [waitingOrchestrator, continueBuild]);

  // --- Review state (pure derivation — no useState) ---
  // The review agent uses MCP tools to signal completion and create fix phases directly.
  // A completed review session means the agent has finished (approved or fix phases created).
  const { reviewComplete, reviewVerdict } = useMemo(() => {
    if (!reviewSession || reviewSession.status !== "completed") {
      return { reviewComplete: false, reviewVerdict: null as "approved" | "changes_requested" | null };
    }
    return { reviewComplete: true, reviewVerdict: "approved" as const };
  }, [reviewSession]);

  // --- Generic question response handler (works for ANY agent type) ---
  const handleSessionQuestionResponse = useCallback(
    (entry: FeatureSession, response: string) => {
      questionResponse(entry, response);
    },
    [questionResponse],
  );

  // --- handleAddFixPhase wrapper (bind review blocks) ---
  const handleAddFixPhase = useCallback(
    () => addFixPhase(reviewSession?.blocks ?? []),
    [addFixPhase, reviewSession],
  );

  return {
    // Simplified state accessors for useFeatureState compatibility
    plan: { status: statusOf(planSession), blocks: blocksOf(planSession) },
    brainstorm: { status: statusOf(brainstormSession), blocks: blocksOf(brainstormSession) },
    execute: { status: executeStatus, blocks: executeSessions.flatMap((s) => s.blocks) },
    risk: { status: statusOf(riskSession), blocks: blocksOf(riskSession) },
    review: { status: statusOf(reviewSession), blocks: blocksOf(reviewSession) },
    resumableByType: new Map<string, { claudeSessionId: string; sessionDbId: number }>(),
    reviewComplete,
    reviewVerdict,
    // Loading states (from mutations)
    isPreparingWorktree: mut.isPreparingWorktree,
    isStartingPlan: mut.isStartingPlan,
    isStartingBrainstorm: mut.isStartingBrainstorm,
    isStartingExecute: mut.isStartingExecute,
    isStartingRisk: mut.isStartingRisk,
    isStartingReview: mut.isStartingReview,
    isAddingFixPhase: mut.isAddingFixPhase,
    isStartingFix: mut.isStartingFix,
    // Action handlers
    handleStartPlanning: mut.handleStartPlanning,
    handleStartBrainstorming: mut.handleStartBrainstorming,
    handleSessionQuestionResponse,
    handleStartBuilding: mut.handleStartBuilding,
    handleStartRisk: mut.handleStartRisk,
    handleStartReview: mut.handleStartReview,
    handleAddFixPhase,
    handleFixImmediately: mut.handleFixImmediately,
    handleResume: mut.handleResume,
    handleAgentSend: mut.handleAgentSend,
    handleAgentStop: mut.handleAgentStop,
    sendToExecuteSubprocess: mut.sendToExecuteSubprocess,
    interruptExecuteSubprocess: mut.interruptExecuteSubprocess,
    // Continue build
    canContinueBuild,
    executeWaitingNextStep: null as number | null,
    handleContinueBuild,
    isContinuingBuild: mut.isContinuingBuild,
    // Session list
    sessionEntries,
    hasAnyAgentOutput,
    noAgentsRunning,
    // Workflow session
    handleStartWorkflowSession: mut.handleStartWorkflowSession,
    handleMarkSessionDone: mut.handleMarkSessionDone,
    isStartingWorkflowSession: mut.isStartingWorkflowSession,
  };
}
