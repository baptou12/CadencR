/**
 * Workflow agent orchestration hook — handles mutations and actions.
 * Data comes from useFeatureAgentState (single query + streaming buffer).
 */

import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/trpc";
import { useFeatureAgentState, type FeatureSession } from "@/hooks/useFeatureAgentState";
import type { AgentType } from "../../main/agents/types";
import type { AgentStatus } from "@/components/AgentSession";
import { parseQuestionAnswers } from "@/lib/parse-question-answers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseWorkflowAgentsParams {
  featureId: number;
  projectId: number;
  featureQuery?: { refetch: () => unknown };
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
}: UseWorkflowAgentsParams) {
  const [description, setDescription] = useState("");
  const { sessions, refetch } = useFeatureAgentState(featureId);

  // Mutations
  const ensureWorktreeMutation = trpc.agents.ensureWorktree.useMutation();
  const startPlanMutation = trpc.agents.startPlan.useMutation();
  const startBrainstormMutation = trpc.agents.startBrainstorm.useMutation();
  const startExecuteMutation = trpc.agents.startExecute.useMutation();
  const startRiskMutation = trpc.agents.startRisk.useMutation();
  const startReviewMutation = trpc.agents.startReview.useMutation();
  const addFixPhaseMutation = trpc.agents.addFixPhase.useMutation();
  const startExecuteForFixMutation = trpc.agents.startExecute.useMutation();
  const submitAnswersMutation = trpc.agents.submitAnswers.useMutation();
  const stopMutation = trpc.agents.stop.useMutation();
  const stopBySessionIdMutation = trpc.agents.stopBySessionId.useMutation();
  const interruptMutation = trpc.agents.interrupt.useMutation();
  const interruptBySessionIdMutation = trpc.agents.interruptBySessionId.useMutation();
  const sendMessageMutation = trpc.agents.sendMessage.useMutation();
  const resumeMutation = trpc.agents.resume.useMutation();
  const continueExecuteMutation = trpc.agents.continueExecute.useMutation();
  const startWorkflowSessionMutation = trpc.agents.startWorkflowSession.useMutation();

  // --- Session entry list for display ---
  // Group sessions into display entries
  const sessionEntries: FeatureSession[] = useMemo(() => {
    return sessions.filter((s) => {
      // Hide execute orchestrator sessions (no subprocess, no phase — just bookkeeping)
      if (s.agentType === "execute" && s.runId == null && !s.subprocessId) return false;
      // Hide idle sessions with no output
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

  // Execute sessions (may be multiple for parallel phases)
  const executeSessions = useMemo(
    () => sessions.filter((s) => s.agentType === "execute" && s.subprocessId),
    [sessions],
  );

  const hasAnyAgentOutput = sessionEntries.length > 0;
  const noAgentsRunning = sessions.every((s) => s.status !== "running");

  // --- Continue build state (Level 2 autonomy) ---
  const waitingOrchestrator = useMemo(
    () => sessions.find((s) => s.agentType === "execute" && s.runId == null && s.status === "paused"),
    [sessions],
  );
  const canContinueBuild = waitingOrchestrator != null;

  // Execute overall status (includes orchestrator state for paused/waiting)
  const executeStatus: AgentStatus = useMemo(() => {
    if (executeSessions.length === 0) {
      // No child sessions yet — check if the orchestrator is paused/waiting (e.g. after restart)
      if (waitingOrchestrator) return "paused";
      return "idle";
    }
    if (executeSessions.some((s) => s.status === "running")) return "running";
    if (executeSessions.some((s) => s.status === "paused")) return "paused";
    if (executeSessions.some((s) => s.status === "error")) return "error";
    if (executeSessions.every((s) => s.status === "completed")) return "completed";
    return "idle";
  }, [executeSessions, waitingOrchestrator]);
  const [executeWaitingNextStep, setExecuteWaitingNextStep] = useState<number | null>(null);
  const isContinuingBuild = continueExecuteMutation.isLoading;

  const handleContinueBuild = useCallback(async () => {
    if (!waitingOrchestrator) return;
    setExecuteWaitingNextStep(null);
    try {
      await continueExecuteMutation.mutateAsync({ sessionDbId: waitingOrchestrator.sessionDbId });
      // Refetch so the newly spawned child sessions appear immediately
      void refetch();
    } catch {
      // error handled by query refetch
    }
  }, [waitingOrchestrator, continueExecuteMutation, refetch]);

  // --- Review state ---
  const [reviewComplete, setReviewComplete] = useState(false);
  const [reviewVerdict, setReviewVerdict] = useState<"approved" | "changes_requested" | null>(null);

  // Detect review completion from text content
  useMemo(() => {
    if (!reviewSession || reviewSession.status !== "completed") return;
    const fullText = reviewSession.blocks
      .filter((b) => b.type === "text")
      .map((b) => b.content)
      .join("");
    if (fullText.includes("---REVIEW_APPROVED---")) {
      setReviewComplete(true);
      setReviewVerdict("approved");
    } else if (fullText.includes("---REVIEW_CHANGES_REQUESTED---")) {
      setReviewComplete(true);
      setReviewVerdict("changes_requested");
    }
  }, [reviewSession]);

  // --- Action handlers ---

  const handleStartPlanning = async () => {
    if (!description.trim()) return;
    try {
      // Step 1: Ensure worktree exists (blocks with live progress via WorktreeSetupSection)
      await ensureWorktreeMutation.mutateAsync({
        featureId,
        projectId,
        description: description.trim(),
      });
      // Step 2: Start plan agent — worktree path is now available via resolveAgentCwd
      await startPlanMutation.mutateAsync({
        featureId,
        projectId,
        description: description.trim(),
      });
      void refetch();
    } catch {
      // Error will show via query refetch
    }
  };

  const handleStartBrainstorming = async () => {
    if (!description.trim()) return;
    try {
      // Step 1: Ensure worktree exists (blocks with live progress via WorktreeSetupSection)
      await ensureWorktreeMutation.mutateAsync({
        featureId,
        projectId,
        description: description.trim(),
      });
      // Step 2: Start brainstorm agent — worktree path is now available via resolveAgentCwd
      await startBrainstormMutation.mutateAsync({
        featureId,
        projectId,
        description: description.trim(),
      });
      void refetch();
    } catch {
      // Error will show via query refetch
    }
  };

  const handleStartBuilding = async () => {
    try {
      await startExecuteMutation.mutateAsync({ featureId, projectId });
      void refetch();
    } catch {
      // Error will show via query refetch
    }
  };

  const handleStartRisk = async () => {
    try {
      await startRiskMutation.mutateAsync({ featureId, projectId });
      void refetch();
    } catch {
      // Error will show via query refetch
    }
  };

  const handleStartReview = async () => {
    setReviewComplete(false);
    setReviewVerdict(null);
    try {
      await startReviewMutation.mutateAsync({ featureId, projectId });
      void refetch();
    } catch {
      // Error will show via query refetch
    }
  };

  // Generic question response handler
  const handleQuestionResponse = useCallback(
    (session: FeatureSession | undefined, response: string) => {
      if (!session?.subprocessId || !session.pendingQuestions?.length) return;
      const answers = parseQuestionAnswers(session.pendingQuestions, response);
      submitAnswersMutation.mutate({
        subprocessId: session.subprocessId,
        answers,
      });
    },
    [submitAnswersMutation],
  );

  const handleResume = useCallback(
    async (agentType: AgentType, targetSessionDbId?: number) => {
      // Find the session to resume
      const session = targetSessionDbId
        ? sessions.find((s) => s.sessionDbId === targetSessionDbId)
        : sessions.find((s) => s.agentType === agentType && s.resumable);

      if (!session?.claudeSessionId) return;

      try {
        await resumeMutation.mutateAsync({
          featureId,
          projectId,
          agentType,
          sessionId: session.claudeSessionId,
          originalSessionDbId: session.sessionDbId,
        });
        void refetch();
      } catch {
        // Error shown via refetch
      }
    },
    [sessions, featureId, projectId, resumeMutation, refetch],
  );

  const handleAgentSend = useCallback(
    async (agentType: AgentType, message: string) => {
      const session = sessions.find(
        (s) => s.agentType === agentType && s.subprocessId,
      );
      if (!session?.subprocessId) return;
      try {
        const result = await sendMessageMutation.mutateAsync({ id: session.subprocessId, message });
        if (result.success) return;
      } catch {
        // fall through to resume
      }
      // Send failed — try to resume if we have a claude session ID
      const resumable = sessions.find(
        (s) => s.agentType === agentType && s.claudeSessionId,
      );
      if (resumable?.claudeSessionId) {
        try {
          await resumeMutation.mutateAsync({
            featureId,
            projectId,
            agentType,
            sessionId: resumable.claudeSessionId,
            originalSessionDbId: resumable.sessionDbId,
            prompt: message,
          });
          void refetch();
        } catch {
          // Error shown via refetch
        }
      }
    },
    [sessions, sendMessageMutation, resumeMutation, featureId, projectId, refetch],
  );

  const handleAgentStop = useCallback(
    async (agentType: AgentType) => {
      const session = sessions.find(
        (s) => s.agentType === agentType && (s.status === "running" || s.subprocessId),
      );
      if (!session) return;
      try {
        if (session.subprocessId) {
          await stopMutation.mutateAsync({ id: session.subprocessId });
        } else {
          await stopBySessionIdMutation.mutateAsync({ sessionId: session.sessionDbId });
        }
      } catch {
        // best effort
      }
      void refetch();
    },
    [sessions, stopMutation, stopBySessionIdMutation, refetch],
  );

  const sendToExecuteSubprocess = useCallback(
    async (subprocessId: string, message: string) => {
      try {
        await sendMessageMutation.mutateAsync({ id: subprocessId, message });
      } catch {
        // Best-effort — execute subprocess messages are orchestrator-driven
      }
    },
    [sendMessageMutation],
  );

  const interruptExecuteSubprocess = useCallback(
    async (subprocessId: string, sessionDbId?: number) => {
      try {
        await interruptMutation.mutateAsync({ id: subprocessId });
      } catch {
        if (sessionDbId != null) {
          await interruptBySessionIdMutation.mutateAsync({ sessionId: sessionDbId }).catch(() => {});
        }
      }
      void refetch();
    },
    [interruptMutation, interruptBySessionIdMutation, refetch],
  );

  const handleAddFixPhase = async () => {
    const reviewText = (reviewSession?.blocks ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.content)
      .join("\n");
    try {
      await addFixPhaseMutation.mutateAsync({
        featureId,
        fixDescription: `Fix the following issues identified during code review:\n\n${reviewText}`,
      });
    } catch {
      // error handled
    }
  };

  const handleFixImmediately = async () => {
    try {
      await startExecuteForFixMutation.mutateAsync({ featureId, projectId });
      void refetch();
    } catch {
      // error handled
    }
  };

  // --- Workflow session handlers ---
  const handleStartWorkflowSession = useCallback(async () => {
    try {
      await startWorkflowSessionMutation.mutateAsync({ featureId, projectId });
      void refetch();
    } catch {
      // Error will show via query refetch
    }
  }, [startWorkflowSessionMutation, featureId, projectId, refetch]);

  const handleMarkSessionDone = useCallback(async (sessionDbId: number) => {
    try {
      await stopBySessionIdMutation.mutateAsync({ sessionId: sessionDbId });
    } catch {
      // best effort
    }
    void refetch();
  }, [stopBySessionIdMutation, refetch]);

  // Track open agent panel
  const [openAgent, setOpenAgent] = useState<string | null>(null); // stores unique key like "execute-123" or "plan-45"

  return {
    description,
    setDescription,
    // Simplified state accessors for useFeatureState compatibility
    plan: { status: statusOf(planSession), blocks: blocksOf(planSession) },
    brainstorm: { status: statusOf(brainstormSession), blocks: blocksOf(brainstormSession) },
    execute: { status: executeStatus, blocks: executeSessions.flatMap((s) => s.blocks) },
    risk: { status: statusOf(riskSession), blocks: blocksOf(riskSession) },
    review: { status: statusOf(reviewSession), blocks: blocksOf(reviewSession) },
    resumableByType: new Map<string, { claudeSessionId: string; sessionDbId: number }>(),
    reviewComplete,
    reviewVerdict,
    isPreparingWorktree: ensureWorktreeMutation.isLoading,
    isStartingPlan: startPlanMutation.isLoading || ensureWorktreeMutation.isLoading,
    isStartingBrainstorm: startBrainstormMutation.isLoading || ensureWorktreeMutation.isLoading,
    isStartingExecute: startExecuteMutation.isLoading,
    isStartingRisk: startRiskMutation.isLoading,
    isStartingReview: startReviewMutation.isLoading,
    isAddingFixPhase: addFixPhaseMutation.isLoading,
    isStartingFix: startExecuteForFixMutation.isLoading,
    handleStartPlanning,
    handleStartBrainstorming,
    handleQuestionResponse: (response: string) => handleQuestionResponse(planSession, response),
    handleBrainstormQuestionResponse: (response: string) => handleQuestionResponse(brainstormSession, response),
    handleExecuteQuestionResponse: (response: string) => {
      // Find the execute session with pending questions
      const execWithQ = executeSessions.find((s) => s.pendingQuestions && s.pendingQuestions.length > 0);
      handleQuestionResponse(execWithQ, response);
    },
    handleRiskQuestionResponse: (response: string) => handleQuestionResponse(riskSession, response),
    handleReviewQuestionResponse: (response: string) => handleQuestionResponse(reviewSession, response),
    handleStartBuilding,
    handleStartRisk,
    handleStartReview,
    handleAddFixPhase,
    handleFixImmediately,
    handleResume,
    handleAgentSend,
    handleAgentStop,
    sendToExecuteSubprocess,
    interruptExecuteSubprocess,
    // Continue build
    canContinueBuild,
    executeWaitingNextStep,
    handleContinueBuild,
    isContinuingBuild,
    // Session list
    sessionEntries,
    hasAnyAgentOutput,
    noAgentsRunning,
    openAgent,
    setOpenAgent,
    // Workflow session
    handleStartWorkflowSession,
    handleMarkSessionDone,
    isStartingWorkflowSession: startWorkflowSessionMutation.isLoading,
  };
}
