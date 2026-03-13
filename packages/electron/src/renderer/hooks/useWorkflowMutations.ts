/**
 * Workflow mutation declarations and action handlers.
 * Extracted from useWorkflowAgents to separate concerns.
 */

import { useCallback } from "react";
import { trpc } from "@/trpc";
import type { FeatureSession } from "@/hooks/useFeatureAgentState";
import type { AgentType } from "../../main/agents/types";
import { parseQuestionAnswers } from "@/lib/parse-question-answers";

interface UseWorkflowMutationsParams {
  featureId: number;
  projectId: number;
  sessions: FeatureSession[];
  refetch: () => unknown;
  /** Current description text from the component — needed by plan/prd starters */
  getDescription: () => string;
}

export function useWorkflowMutations({
  featureId,
  projectId,
  sessions,
  refetch,
  getDescription,
}: UseWorkflowMutationsParams) {
  // Mutations
  const ensureWorktreeMutation = trpc.workflow.ensureWorktree.useMutation();
  const startPlanMutation = trpc.workflow.startPlan.useMutation();
  const startPrdMutation = trpc.workflow.startPrd.useMutation();
  const startExecuteMutation = trpc.workflow.startExecute.useMutation();
  const startRiskMutation = trpc.workflow.startRisk.useMutation();
  const startReviewMutation = trpc.workflow.startReview.useMutation();
  const startRetroMutation = trpc.workflow.startRetro.useMutation();
  const addFixPhaseMutation = trpc.workflow.addFixPhase.useMutation();
  const startExecuteForFixMutation = trpc.workflow.startExecute.useMutation();
  const submitAnswersMutation = trpc.agents.submitAnswers.useMutation();
  const stopMutation = trpc.agents.stop.useMutation();
  const stopBySessionIdMutation = trpc.sessions.stopBySessionId.useMutation();
  const interruptMutation = trpc.agents.interrupt.useMutation();
  const interruptBySessionIdMutation = trpc.sessions.interruptBySessionId.useMutation();
  const sendMessageMutation = trpc.agents.sendMessage.useMutation();
  const resumeMutation = trpc.agents.resume.useMutation();
  const continueExecuteMutation = trpc.workflow.continueExecute.useMutation();
  const startWorkflowSessionMutation = trpc.workflow.startWorkflowSession.useMutation();
  const startRefinePlanMutation = trpc.workflow.startRefinePlan.useMutation();

  // --- Action handlers ---

  const handleStartPlanning = async (images?: Array<{ base64: string; mimeType: string }>) => {
    const description = getDescription();
    if (!description.trim()) return;
    try {
      await ensureWorktreeMutation.mutateAsync({
        featureId,
        projectId,
        description: description.trim(),
      });
      await startPlanMutation.mutateAsync({
        featureId,
        projectId,
        description: description.trim(),
        ...(images && images.length > 0 ? { images } : {}),
      });
      void refetch();
    } catch {
      // Error will show via query refetch
    }
  };

  const handleStartPrd = async (images?: Array<{ base64: string; mimeType: string }>) => {
    const description = getDescription();
    if (!description.trim()) return;
    try {
      await ensureWorktreeMutation.mutateAsync({
        featureId,
        projectId,
        description: description.trim(),
      });
      await startPrdMutation.mutateAsync({
        featureId,
        projectId,
        description: description.trim(),
        ...(images && images.length > 0 ? { images } : {}),
      });
      void refetch();
    } catch {
      // Error will show via query refetch
    }
  };

  const handleStartRefinePlan = async (description: string, images?: Array<{ base64: string; mimeType: string }>) => {
    if (!description.trim()) return;
    try {
      await startRefinePlanMutation.mutateAsync({
        featureId,
        projectId,
        description: description.trim(),
        ...(images && images.length > 0 ? { images } : {}),
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
    try {
      await startReviewMutation.mutateAsync({ featureId, projectId });
      void refetch();
    } catch {
      // Error will show via query refetch
    }
  };

  const handleStartRetro = async () => {
    try {
      await startRetroMutation.mutateAsync({ featureId, projectId });
      void refetch();
    } catch {
      // Error will show via query refetch
    }
  };

  const handleQuestionResponse = useCallback(
    async (session: FeatureSession | undefined, response: string) => {
      if (!session?.pendingQuestions?.length) return;
      const answers = parseQuestionAnswers(session.pendingQuestions, response);

      // 1. Live subprocess — submit directly
      if (session.subprocessId) {
        submitAnswersMutation.mutate({
          subprocessId: session.subprocessId,
          answers,
        });
        return;
      }

      // 2. No subprocess (e.g. after restart) — clear question & resume with answer as prompt
      const formatted = Object.entries(answers)
        .map(([q, a]) => `${q}\nAnswer: ${a}`)
        .join("\n\n");
      try {
        if (session.claudeSessionId) {
          await resumeMutation.mutateAsync({
            featureId,
            projectId,
            agentType: session.agentType as AgentType,
            sessionId: session.claudeSessionId,
            originalSessionDbId: session.sessionDbId,
            prompt: formatted,
          });
        }
      } catch (err) {
        console.error("[useWorkflowMutations] Failed to resume for question answer:", err);
      }
      void refetch();
    },
    [submitAnswersMutation, resumeMutation, featureId, projectId, refetch],
  );

  const handleResume = useCallback(
    async (agentType: AgentType, targetSessionDbId?: number) => {
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
    async (
      session: Pick<FeatureSession, "agentType" | "sessionDbId" | "subprocessId" | "claudeSessionId">,
      message: string,
      images?: Array<{ base64: string; mimeType: string }>,
    ) => {
      // 1. Try active subprocess — use the EXACT session's subprocessId
      if (session.subprocessId) {
        try {
          const result = await sendMessageMutation.mutateAsync({ id: session.subprocessId, message, images });
          if (result.success) {
            void refetch();
            return;
          }
        } catch {
          // fall through to resume
        }
      }
      // 2. Try resume via this session's claude session ID
      if (session.claudeSessionId) {
        try {
          await resumeMutation.mutateAsync({
            featureId,
            projectId,
            agentType: session.agentType,
            sessionId: session.claudeSessionId,
            originalSessionDbId: session.sessionDbId,
            prompt: message,
            images,
          });
        } catch (err) {
          console.error("[useWorkflowMutations] Failed to resume agent:", err);
        }
        void refetch();
      }
    },
    [sendMessageMutation, resumeMutation, featureId, projectId, refetch],
  );

  const handleAgentStop = useCallback(
    async (session: Pick<FeatureSession, "subprocessId" | "sessionDbId">) => {
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
    [stopMutation, stopBySessionIdMutation, refetch],
  );

  const sendToExecuteSubprocess = useCallback(
    async (subprocessId: string, message: string, images?: Array<{ base64: string; mimeType: string }>) => {
      try {
        await sendMessageMutation.mutateAsync({ id: subprocessId, message, images });
      } catch {
        // Best-effort
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

  const handleContinueBuild = useCallback(async () => {
    try {
      await continueExecuteMutation.mutateAsync({ featureId, projectId });
      void refetch();
    } catch {
      // error handled by query refetch
    }
  }, [continueExecuteMutation, featureId, projectId, refetch]);

  const handleAddFixPhase = useCallback(async (reviewBlocks: FeatureSession["blocks"]) => {
    const reviewText = reviewBlocks
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
  }, [addFixPhaseMutation, featureId]);

  const handleFixImmediately = async () => {
    try {
      await startExecuteForFixMutation.mutateAsync({ featureId, projectId });
      void refetch();
    } catch {
      // error handled
    }
  };

  const handleStartWorkflowSession = useCallback(async (prompt: string, _images?: Array<{ base64: string; mimeType: string }>) => {
    if (!prompt.trim()) return;
    try {
      await startWorkflowSessionMutation.mutateAsync({ featureId, projectId, prompt: prompt.trim() });
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

  return {
    // Loading states
    isPreparingWorktree: ensureWorktreeMutation.isLoading,
    isStartingPlan: startPlanMutation.isLoading || ensureWorktreeMutation.isLoading,
    isStartingPrd: startPrdMutation.isLoading || ensureWorktreeMutation.isLoading,
    isStartingExecute: startExecuteMutation.isLoading,
    isStartingRisk: startRiskMutation.isLoading,
    isStartingReview: startReviewMutation.isLoading,
    isStartingRetro: startRetroMutation.isLoading,
    isAddingFixPhase: addFixPhaseMutation.isLoading,
    isStartingFix: startExecuteForFixMutation.isLoading,
    isContinuingBuild: continueExecuteMutation.isLoading,
    isStartingWorkflowSession: startWorkflowSessionMutation.isLoading,
    isStartingRefinePlan: startRefinePlanMutation.isLoading,
    // Handlers
    handleStartPlanning,
    handleStartPrd,
    handleStartRefinePlan,
    handleStartBuilding,
    handleStartRisk,
    handleStartReview,
    handleStartRetro,
    handleQuestionResponse,
    handleResume,
    handleAgentSend,
    handleAgentStop,
    sendToExecuteSubprocess,
    interruptExecuteSubprocess,
    handleContinueBuild,
    handleAddFixPhase,
    handleFixImmediately,
    handleStartWorkflowSession,
    handleMarkSessionDone,
  };
}
