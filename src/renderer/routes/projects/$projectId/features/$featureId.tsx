import { useState, useCallback, useRef, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { trpc } from "@/trpc";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { AgentSession, type AgentSessionHandle } from "@/components/AgentSession";
import { FeatureWorkflowView } from "@/components/FeatureWorkflowView";
import { DiffViewerModal } from "@/components/diff/DiffViewerModal";
import { useFeatureAgentState } from "@/hooks/useFeatureAgentState";
import { useContextUsage } from "@/hooks/useContextUsage";
import { useResolvedModel } from "@/hooks/useResolvedModel";

export const Route = createFileRoute(
  "/projects/$projectId/features/$featureId",
)({
  component: FeaturePage,
});

function FeaturePage() {
  const { featureId, projectId } = Route.useParams();
  const numericFeatureId = Number(featureId);
  const numericProjectId = Number(projectId);

  const featureQuery = trpc.features.getById.useQuery({
    id: numericFeatureId,
  });
  const feature = featureQuery.data ?? undefined;

  if (feature?.type === "session") {
    return (
      <SessionFeatureView
        featureId={numericFeatureId}
        projectId={numericProjectId}
      />
    );
  }

  return (
    <FeatureWorkflowView
      featureId={numericFeatureId}
      projectId={numericProjectId}
      feature={feature}
      featureQuery={featureQuery}
    />
  );
}

// ---------------------------------------------------------------------------
// Session feature — uses AgentSession in full-screen mode
// ---------------------------------------------------------------------------

function SessionFeatureView({
  featureId,
  projectId,
}: {
  featureId: number;
  projectId: number;
}) {
  const { sessions, refetch } = useFeatureAgentState(featureId);
  const contextUsageMap = useContextUsage(featureId, sessions);
  const agentRef = useRef<AgentSessionHandle>(null);
  const [inlineDiffOpen, setInlineDiffOpen] = useState(false);
  const handleViewDiff = useCallback(() => setInlineDiffOpen(true), []);

  // Model settings for the session (resolved through hierarchy)
  const { resolveModel, handleModelChange: handleModelChangeRaw } = useResolvedModel(featureId, projectId);
  const currentModelId = resolveModel("session");
  const handleModelChange = useCallback(
    (modelId: string) => handleModelChangeRaw("session", modelId),
    [handleModelChangeRaw],
  );

  // Auto-focus prompt bar when session view mounts (e.g. after creating a new session)
  useEffect(() => {
    requestAnimationFrame(() => {
      agentRef.current?.focusPromptBar();
    });
  }, []);

  // Find the latest session agent
  const session = sessions.find((s) => s.agentType === "session");
  const status = session?.status ?? "idle";
  const blocks = session?.blocks ?? [];
  const hasFileChanges = session?.hasFileChanges ?? false;
  const todos = session?.todos ?? null;

  // Permission mode state — initialized from DB, toggled locally
  const [permissionMode, setPermissionMode] = useState<"bypassPermissions" | "plan">(
    (session?.permissionMode as "bypassPermissions" | "plan") ?? "bypassPermissions",
  );
  // Sync from DB when session data loads/changes
  useEffect(() => {
    if (session?.permissionMode) {
      setPermissionMode(session.permissionMode as "bypassPermissions" | "plan");
    }
  }, [session?.permissionMode]);

  // Mutations
  const startSessionMutation = trpc.agents.startSession.useMutation();
  const sendMessageMutation = trpc.agents.sendMessage.useMutation();
  const interruptMutation = trpc.agents.interrupt.useMutation();
  const resumeMutation = trpc.agents.resume.useMutation();
  const setPermissionModeMutation = trpc.agents.setPermissionMode.useMutation();
  const submitAnswersMutation = trpc.agents.submitAnswers.useMutation();
  const submitPlanApprovalMutation = trpc.agents.submitPlanApproval.useMutation();

  const handlePermissionModeToggle = useCallback(() => {
    const newMode = permissionMode === "bypassPermissions" ? "plan" : "bypassPermissions";
    setPermissionMode(newMode);
    if (session?.sessionDbId) {
      setPermissionModeMutation.mutate({ sessionId: session.sessionDbId, mode: newMode });
    }
  }, [permissionMode, session?.sessionDbId, setPermissionModeMutation]);

  const handlePlanApprove = useCallback(() => {
    if (!session?.subprocessId) return;
    submitPlanApprovalMutation.mutate({ subprocessId: session.subprocessId, approved: true });
    // Optimistically update local permission mode
    setPermissionMode("bypassPermissions");
  }, [session?.subprocessId, submitPlanApprovalMutation]);

  const handlePlanRequestChanges = useCallback((feedback: string) => {
    if (!session?.subprocessId) return;
    submitPlanApprovalMutation.mutate({ subprocessId: session.subprocessId, approved: false, feedback });
  }, [session?.subprocessId, submitPlanApprovalMutation]);

  const handleAnswerSubmit = useCallback(
    (response: string) => {
      if (!session?.subprocessId || !session.pendingQuestions?.length) return;
      const answers: Record<string, string> = {};
      const sections = response.split("\n\n");
      session.pendingQuestions.forEach((q, index) => {
        const section = sections[index];
        if (section) {
          const answerMatch = section.match(/Answer:\s*(.+)/s);
          if (answerMatch) {
            answers[q.question] = answerMatch[1].trim();
          }
        }
      });
      submitAnswersMutation.mutate({
        subprocessId: session.subprocessId,
        answers,
      });
    },
    [session?.subprocessId, session?.pendingQuestions, submitAnswersMutation],
  );

  const handleSend = useCallback(
    async (message: string) => {
      if (session?.subprocessId && (status === "running" || status === "paused")) {
        sendMessageMutation.mutate({ id: session.subprocessId, message });
        return;
      }

      // Resume a paused session
      if (status === "paused" && session?.claudeSessionId) {
        try {
          const result = await resumeMutation.mutateAsync({
            featureId,
            projectId,
            agentType: "session",
            sessionId: session.claudeSessionId,
            originalSessionDbId: session.sessionDbId,
          });
          sendMessageMutation.mutate({ id: result.subprocessId, message });
          void refetch();
        } catch {
          // Error shown via refetch
        }
        return;
      }

      // Start a new session
      try {
        await startSessionMutation.mutateAsync({
          featureId,
          projectId,
          prompt: message,
          permissionMode,
        });
        void refetch();
      } catch {
        // Error shown via refetch
      }
    },
    [session, status, featureId, projectId, permissionMode, sendMessageMutation, startSessionMutation, resumeMutation, refetch],
  );

  const handleStop = useCallback(async () => {
    if (!session?.subprocessId) return;
    try {
      await interruptMutation.mutateAsync({ id: session.subprocessId });
    } catch {
      // best effort
    }
    void refetch();
  }, [session?.subprocessId, interruptMutation, refetch]);

  return (
    <div className="flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} mode="session" className="shrink-0" />
      {status === "paused" && !session?.subprocessId && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          Previous session paused — type a message to resume.
        </div>
      )}
      <AgentSession
        ref={agentRef}
        agentType="session"
        blocks={blocks}
        status={status}
        onSend={handleSend}
        onStop={handleStop}
        pendingQuestions={session?.pendingQuestions ?? undefined}
        onAnswerSubmit={handleAnswerSubmit}
        disabled={startSessionMutation.isLoading || resumeMutation.isLoading}
        hasFileChanges={hasFileChanges}
        onViewDiff={handleViewDiff}
        todos={todos}
        permissionMode={permissionMode}
        onPermissionModeToggle={handlePermissionModeToggle}
        pendingPlanApproval={session?.pendingPlanApproval}
        onPlanApprove={handlePlanApprove}
        onPlanRequestChanges={handlePlanRequestChanges}
        contextUsage={session ? contextUsageMap.get(session.sessionDbId) : null}
        currentModelId={currentModelId}
        onModelChange={handleModelChange}
        featureId={featureId}
        className="min-h-0"
      />
      <DiffViewerModal
        featureId={featureId}
        open={inlineDiffOpen}
        onOpenChange={setInlineDiffOpen}
      />
    </div>
  );
}
