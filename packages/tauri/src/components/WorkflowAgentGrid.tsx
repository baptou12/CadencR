import { type AgentSessionHandle, AgentSession, AGENT_LABELS } from "@/components/AgentSession";
import type { FeatureSession } from "@/hooks/useFeatureAgentState";
import type { ContextUsageState } from "@/types/agent";
import type { AgentType } from "@/types/agent-types";
import type { useWorkflowBackend } from "@/hooks/useWorkflowBackend";
import { cn } from "@/lib/utils";

interface WorkflowAgentGridProps {
  backend: ReturnType<typeof useWorkflowBackend>;
  featureId: number;
  projectId: number;
  openAgent: string | null;
  setOpenAgent: React.Dispatch<React.SetStateAction<string | null>>;
  maximizedAgent: string | null;
  setMaximizedAgent: React.Dispatch<React.SetStateAction<string | null>>;
  setAgentRef: (index: number, handle: AgentSessionHandle | null) => void;
  agentsWithQuestions: number;
  contextUsageMap: Map<number, ContextUsageState>;
  resolveModel: (agentType: AgentType) => string;
  handleModelChange: (agentType: AgentType, modelId: string) => void;
  handleDeleteAgent: (entry: FeatureSession) => void;
  onViewDiff: () => void;
  slashCommands: { name: string; description: string }[];
  slashCommandsLoading: boolean;
}

export function WorkflowAgentGrid({
  backend,
  featureId,
  projectId,
  openAgent,
  setOpenAgent,
  maximizedAgent,
  setMaximizedAgent,
  setAgentRef,
  agentsWithQuestions,
  contextUsageMap,
  resolveModel,
  handleModelChange,
  handleDeleteAgent,
  onViewDiff,
  slashCommands,
  slashCommandsLoading,
}: WorkflowAgentGridProps) {
  const renderAgent = (entry: FeatureSession, index: number, isGridItem: boolean) => {
    const label =
      (entry.agentType === "execute" || entry.agentType === "qa") && entry.phaseTitle
        ? `${AGENT_LABELS[entry.agentType] ?? entry.agentType} - ${entry.phaseTitle}`
        : (AGENT_LABELS[entry.agentType] ?? entry.agentType);
    const sessionKey = `${entry.agentType}-${entry.sessionDbId}`;
    const questions = entry.pendingQuestions ?? [];
    const isThisMaximized = maximizedAgent === sessionKey;
    if (maximizedAgent && !isThisMaximized) return null;
    return (
      <AgentSession
        key={sessionKey}
        ref={(handle) => setAgentRef(index, handle)}
        collapsible
        navAgentIndex={index}
        agentType={entry.agentType}
        label={label}
        status={entry.status}
        blocks={entry.blocks}
        open={openAgent === sessionKey || entry.status === "running" || entry.status === "paused"}
        onToggle={() => {
          setOpenAgent((prev) => (prev === sessionKey ? null : sessionKey));
          if (openAgent !== sessionKey && entry.blocks.length === 0 && backend.loadAgentHistory) {
            backend.loadAgentHistory(entry);
          }
        }}
        maximized={isThisMaximized}
        onToggleMaximize={() => setMaximizedAgent((prev) => (prev === sessionKey ? null : sessionKey))}
        pendingQuestions={questions.length > 0 ? questions : undefined}
        disableShortcuts={agentsWithQuestions > 1}
        onMarkDone={
          (entry.agentType === "session" || entry.agentType === "review-fixer") &&
          (entry.status === "running" || entry.status === "paused")
            ? () => backend.markDone(entry.sessionDbId)
            : undefined
        }
        onAnswerSubmit={(response) => backend.submitAnswers(entry, response)}
        onSend={(message, images) => backend.sendToAgent(entry, message, images)}
        onStop={() => backend.stopAgent(entry)}
        resumable={entry.resumable}
        onResume={entry.resumable ? () => void backend.handleResume(entry.agentType, entry.sessionDbId) : undefined}
        hasFileChanges={entry.hasFileChanges}
        onViewDiff={() => onViewDiff()}
        todos={entry.todos}
        currentModelId={resolveModel(entry.agentType)}
        onModelChange={(modelId) => handleModelChange(entry.agentType, modelId)}
        canDelete={entry.status !== "running" && entry.status !== "completed" && !!entry.sessionDbId}
        onDelete={() => handleDeleteAgent(entry)}
        contextUsage={contextUsageMap.get(entry.sessionDbId)}
        featureId={featureId}
        projectId={projectId}
        sessionId={entry.sessionDbId}
        claudeSessionId={entry.claudeSessionId || undefined}
        slashCommandsOverride={slashCommands}
        slashCommandsLoading={slashCommandsLoading}
        initialDraft={entry.draftPrompt}
        pendingPermission={entry.pendingPermission}
        onPermissionDecision={(decision, feedback) => backend.submitPermission(entry, decision, feedback)}
        pendingPlanApproval={entry.pendingPlanApproval}
        planApprovalError={backend.planApprovalError}
        planApproveLabel="Approve"
        onPlanApprove={() => backend.approvePlan(entry.subprocessId, entry.sessionDbId)}
        onPlanRequestChanges={(feedback: string) => backend.rejectPlan(feedback, entry.subprocessId, entry.sessionDbId)}
        className={
          isGridItem
            ? "min-h-0 h-full shrink overflow-hidden"
            : isThisMaximized
              ? "flex-1 min-h-0"
              : undefined
        }
      />
    );
  };

  const activeEntries = backend.sessionEntries.filter((e) => e.status === "running" || e.status === "paused");
  const inactiveEntries = backend.sessionEntries.filter((e) => e.status !== "running" && e.status !== "paused");
  const useGrid = activeEntries.length >= 2 && !maximizedAgent;

  return (
    <>
      {inactiveEntries.map((entry) => {
        const idx = backend.sessionEntries.indexOf(entry);
        return renderAgent(entry, idx, false);
      })}

      {useGrid ? (
        <div
          className={cn(
            "grid gap-2 min-h-0",
            activeEntries.length === 2 && "grid-cols-2",
            activeEntries.length >= 3 && "grid-cols-3",
          )}
          style={{ height: "60vh" }}
        >
          {activeEntries.map((entry) => {
            const idx = backend.sessionEntries.indexOf(entry);
            return renderAgent(entry, idx, true);
          })}
        </div>
      ) : (
        activeEntries.map((entry) => {
          const idx = backend.sessionEntries.indexOf(entry);
          return renderAgent(entry, idx, false);
        })
      )}
    </>
  );
}
