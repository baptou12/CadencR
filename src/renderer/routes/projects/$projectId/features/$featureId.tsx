import { useState, useCallback, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { trpc } from "@/trpc";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { AgentSession, type AgentSessionHandle } from "@/components/AgentSession";
import { FeatureWorkflowView } from "@/components/FeatureWorkflowView";
import { DiffViewerModal } from "@/components/diff/DiffViewerModal";
import { useFeatureAgentState } from "@/hooks/useFeatureAgentState";

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
  const feature = featureQuery.data;

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
  const agentRef = useRef<AgentSessionHandle>(null);
  const [inlineDiffOpen, setInlineDiffOpen] = useState(false);
  const handleViewDiff = useCallback(() => setInlineDiffOpen(true), []);

  // Find the latest session agent
  const session = sessions.find((s) => s.agentType === "session");
  const status = session?.status ?? "idle";
  const blocks = session?.blocks ?? [];
  const hasFileChanges = session?.hasFileChanges ?? false;
  const todos = session?.todos ?? null;

  // Mutations
  const startSessionMutation = trpc.agents.startSession.useMutation();
  const sendMessageMutation = trpc.agents.sendMessage.useMutation();
  const interruptMutation = trpc.agents.interrupt.useMutation();
  const resumeMutation = trpc.agents.resume.useMutation();

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
        });
        void refetch();
      } catch {
        // Error shown via refetch
      }
    },
    [session, status, featureId, projectId, sendMessageMutation, startSessionMutation, resumeMutation, refetch],
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
      <FeatureTopBar featureId={featureId} projectId={projectId} mode="session" />
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
        disabled={startSessionMutation.isLoading || resumeMutation.isLoading}
        hasFileChanges={hasFileChanges}
        onViewDiff={handleViewDiff}
        todos={todos}
      />
      <DiffViewerModal
        featureId={featureId}
        open={inlineDiffOpen}
        onOpenChange={setInlineDiffOpen}
      />
    </div>
  );
}
