/**
 * Workflow agent orchestration hook — session derivation and state.
 * Mutations live in useWorkflowMutations. UI state (description, openAgent) lives in the component.
 */

import { useMemo, useCallback } from "react";
import { useFeatureAgentState, type FeatureSession } from "@/hooks/useFeatureAgentState";
import { useWorkflowMutations } from "@/hooks/useWorkflowMutations";
import type { AgentType } from "../../main/agents/types";
import type { AgentStatus } from "@/types/agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseWorkflowAgentsParams {
  featureId: number;
  projectId: number;
  featureQuery?: { refetch: () => unknown };
  /** Current description text — needed by plan/prd starters */
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
  const prdSession = useMemo(() => findSession("prd"), [findSession]);
  const riskSession = useMemo(() => findSession("risk"), [findSession]);
  const reviewSession = useMemo(() => findSession("review"), [findSession]);

  const executeSessions = useMemo(
    () => sessions.filter((s) => s.agentType === "execute"),
    [sessions],
  );

  const hasAnyAgentOutput = sessionEntries.length > 0;
  const noAgentsRunning = sessions.every((s) => s.status !== "running");

  // --- Continue build state ---
  // Level 2 autonomy: can continue if there are pending phases and no running agents
  const canContinueBuild = useMemo(() => {
    const hasRunning = sessions.some((s) =>
      ["execute", "qa"].includes(s.agentType) && s.status === "running",
    );
    return !hasRunning && noAgentsRunning;
  }, [sessions, noAgentsRunning]);

  const executeStatus: AgentStatus = useMemo(() => {
    if (executeSessions.length === 0) return "idle";
    if (executeSessions.some((s) => s.status === "running")) return "running";
    if (executeSessions.some((s) => s.status === "paused")) return "paused";
    if (executeSessions.some((s) => s.status === "error")) return "error";
    if (executeSessions.every((s) => s.status === "completed")) return "completed";
    return "idle";
  }, [executeSessions]);

  // Continue build: call processNextPhase via tRPC
  const handleContinueBuild = useCallback(async () => {
    await continueBuild();
  }, [continueBuild]);

  // --- Review state (pure derivation — no useState) ---
  // The review agent uses MCP tools to signal completion and create fix phases directly.
  // Verdict is derived from whether the review created fix phases (finalize_phases tool call).
  // Derive review verdict from whether the review agent created fix phases.
  // null = no action needed (approved or not yet complete), "changes_requested" = fix phases created.
  const reviewVerdict = useMemo((): "changes_requested" | null => {
    if (!reviewSession || reviewSession.status !== "completed") return null;
    const calledFinalizePhases = reviewSession.blocks.some(
      (b) => b.type === "tool_call" && b.toolName === "finalize_phases",
    );
    return calledFinalizePhases ? "changes_requested" : null;
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
    prd: { status: statusOf(prdSession), blocks: blocksOf(prdSession) },
    execute: { status: executeStatus, blocks: executeSessions.flatMap((s) => s.blocks) },
    risk: { status: statusOf(riskSession), blocks: blocksOf(riskSession) },
    review: { status: statusOf(reviewSession), blocks: blocksOf(reviewSession) },
    resumableByType: new Map<string, { claudeSessionId: string; sessionDbId: number }>(),
    reviewVerdict,
    // Loading states (from mutations)
    isPreparingWorktree: mut.isPreparingWorktree,
    isStartingPlan: mut.isStartingPlan,
    isStartingPrd: mut.isStartingPrd,
    isStartingExecute: mut.isStartingExecute,
    isStartingRisk: mut.isStartingRisk,
    isStartingReview: mut.isStartingReview,
    isStartingRetro: mut.isStartingRetro,
    isAddingFixPhase: mut.isAddingFixPhase,
    isStartingFix: mut.isStartingFix,
    // Action handlers
    handleStartPlanning: mut.handleStartPlanning,
    handleStartPrd: mut.handleStartPrd,
    handleSessionQuestionResponse,
    handleStartBuilding: mut.handleStartBuilding,
    handleStartRisk: mut.handleStartRisk,
    handleStartReview: mut.handleStartReview,
    handleStartRetro: mut.handleStartRetro,
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
    // Refine
    handleStartRefinePlan: mut.handleStartRefinePlan,
    isStartingRefinePlan: mut.isStartingRefinePlan,
  };
}
