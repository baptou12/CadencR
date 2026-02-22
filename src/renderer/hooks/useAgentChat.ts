/**
 * Shared agent chat handlers — permission decisions, plan approval,
 * answer submission, and permission mode state.
 *
 * Used by both SessionFeatureView and FeatureWorkflowView to avoid
 * duplicating mutation declarations and handler logic.
 */

import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/trpc";
import { parseQuestionAnswers } from "@/lib/parse-question-answers";
import type { FeatureSession } from "@/hooks/useFeatureAgentState";

interface UseAgentChatParams {
  featureId: number;
  projectId: number;
  refetch: () => unknown;
}

export function useAgentChat({ featureId, projectId, refetch }: UseAgentChatParams) {
  const submitToolPermissionMutation = trpc.agents.submitToolPermission.useMutation();
  const submitPlanApprovalMutation = trpc.agents.submitPlanApproval.useMutation();
  const clearPlanApprovalMutation = trpc.agents.clearPlanApproval.useMutation();
  const submitAnswersMutation = trpc.agents.submitAnswers.useMutation();
  const resumeMutation = trpc.agents.resume.useMutation();

  // Track plan approval errors to surface in UI
  const [planApprovalError, setPlanApprovalError] = useState<string | null>(null);

  const handlePermissionDecision = useCallback(
    (subprocessId: string | null | undefined, decision: "allow_once" | "allow_future" | "deny", feedback?: string) => {
      if (!subprocessId) return;
      submitToolPermissionMutation.mutate({ subprocessId, decision, feedback });
    },
    [submitToolPermissionMutation],
  );

  // Helper to clear a stale plan approval when subprocess is gone
  const clearStalePlan = useCallback(
    (sessionDbId: number | undefined) => {
      if (!sessionDbId) return;
      setPlanApprovalError("Agent is no longer running. The plan approval has been cleared — resume the conversation to continue.");
      clearPlanApprovalMutation.mutate(
        { sessionDbId },
        { onSuccess: () => void refetch() },
      );
    },
    [clearPlanApprovalMutation, refetch],
  );

  const handlePlanApprove = useCallback(
    (subprocessId: string | null | undefined, sessionDbId?: number) => {
      if (!subprocessId) {
        clearStalePlan(sessionDbId);
        return;
      }
      setPlanApprovalError(null);
      submitPlanApprovalMutation.mutate(
        { subprocessId, approved: true },
        {
          onSuccess: (data) => {
            if (!data.success) {
              setPlanApprovalError(data.error ?? "Failed to approve plan.");
              void refetch();
            }
          },
          onError: () => {
            setPlanApprovalError("Failed to communicate with the agent.");
          },
        },
      );
    },
    [submitPlanApprovalMutation, clearStalePlan, refetch],
  );

  const handlePlanRequestChanges = useCallback(
    (subprocessId: string | null | undefined, feedback: string, sessionDbId?: number) => {
      if (!subprocessId) {
        clearStalePlan(sessionDbId);
        return;
      }
      setPlanApprovalError(null);
      submitPlanApprovalMutation.mutate(
        { subprocessId, approved: false, feedback },
        {
          onSuccess: (data) => {
            if (!data.success) {
              setPlanApprovalError(data.error ?? "Failed to send feedback.");
              void refetch();
            }
          },
          onError: () => {
            setPlanApprovalError("Failed to communicate with the agent.");
          },
        },
      );
    },
    [submitPlanApprovalMutation, clearStalePlan, refetch],
  );

  const handleAnswerSubmit = useCallback(
    async (session: FeatureSession | undefined, response: string) => {
      if (!session?.pendingQuestions?.length) return;
      const answers = parseQuestionAnswers(session.pendingQuestions, response);

      // 1. Live subprocess — submit directly
      if (session.subprocessId) {
        submitAnswersMutation.mutate({ subprocessId: session.subprocessId, answers });
        return;
      }

      // 2. No subprocess (e.g. after restart) — resume with answer as prompt
      if (session.claudeSessionId) {
        const formatted = Object.entries(answers)
          .map(([q, a]) => `${q}\nAnswer: ${a}`)
          .join("\n\n");
        try {
          await resumeMutation.mutateAsync({
            featureId,
            projectId,
            agentType: session.agentType as "plan" | "brainstorm" | "execute" | "risk" | "review" | "session",
            sessionId: session.claudeSessionId,
            originalSessionDbId: session.sessionDbId,
            prompt: formatted,
          });
        } catch (err) {
          console.error("[useAgentChat] Failed to resume for question answer:", err);
        }
        void refetch();
      }
    },
    [submitAnswersMutation, resumeMutation, featureId, projectId, refetch],
  );

  return {
    handlePermissionDecision,
    handlePlanApprove,
    handlePlanRequestChanges,
    handleAnswerSubmit,
    resumeMutation,
    planApprovalError,
  };
}

// ---------------------------------------------------------------------------
// Permission mode state — only needed by session views
// ---------------------------------------------------------------------------

export function usePermissionMode(session: FeatureSession | undefined) {
  const [permissionMode, setPermissionMode] = useState<"acceptEdits" | "plan">(
    (session?.permissionMode as "acceptEdits" | "plan") ?? "acceptEdits",
  );
  const setPermissionModeMutation = trpc.agents.setPermissionMode.useMutation();

  // Sync from DB when session data loads/changes
  useEffect(() => {
    if (session?.permissionMode) {
      setPermissionMode(session.permissionMode as "acceptEdits" | "plan");
    }
  }, [session?.permissionMode]);

  const handlePermissionModeToggle = useCallback(() => {
    const newMode = permissionMode === "plan" ? "acceptEdits" : "plan";
    setPermissionMode(newMode);
    if (session?.sessionDbId) {
      setPermissionModeMutation.mutate({ sessionId: session.sessionDbId, mode: newMode });
    }
  }, [permissionMode, session?.sessionDbId, setPermissionModeMutation]);

  return { permissionMode, handlePermissionModeToggle, setPermissionMode };
}
