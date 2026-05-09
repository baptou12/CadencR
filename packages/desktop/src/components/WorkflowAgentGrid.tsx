import { type AgentSessionHandle, AgentSession, AGENT_LABELS } from "@/components/agent-session";
import type { FeatureSession } from "@/hooks/useFeatureAgentState";
import type { ContextUsageState, LiveAgentStatus } from "@/types/agent";
import type { AgentType } from "@/types/agent-types";
import type { WorkflowBackend } from "@/hooks/workflowBackendTypes";
import { useEnabledOptInModesByProvider } from "@/hooks/useEnabledOptInModes";
import { capitalize, cn } from "@/lib/utils";
import type { ThinkingEffortLevel } from "@/shared/thinking-effort";
import { useSessionStatusStore } from "@/stores/session-status-store";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import type { ReactElement, ReactNode } from "react";
import { nextProviderMode } from "@/lib/provider-modes";
import { parsePermissionMode } from "@/types/permission-mode";

/**
 * Resolve the live 3-value status for a workflow agent session.
 *
 * Pure function: caller passes the live `bySession` map (typically read
 * once via `useSessionStatusStore` at the parent level so a single
 * subscription covers every grid item). Falls back to deriving from the
 * persisted lifecycle when no live entry has been seen yet (e.g. before
 * the WS snapshot lands, or for completed agents that no longer
 * broadcast).
 */
function liveStatusFor(
  entry: FeatureSession,
  bySession: Record<number, { status: LiveAgentStatus }>,
): LiveAgentStatus {
  const live = bySession[entry.sessionDbId];
  if (live) return live.status;
  switch (entry.status) {
    case "running":
      return "agent";
    case "paused":
      return entry.pendingQuestions && entry.pendingQuestions.length > 0 ? "question" : "idle";
    default:
      return "idle";
  }
}

interface WorkflowAgentGridProps {
  backend: WorkflowBackend;
  featureId: number;
  projectId: number;
  agentVisible: boolean;
  openAgent: string | null;
  setOpenAgent: React.Dispatch<React.SetStateAction<string | null>>;
  maximizedAgent: string | null;
  setMaximizedAgent: React.Dispatch<React.SetStateAction<string | null>>;
  setAgentRef: (index: number, handle: AgentSessionHandle | null) => void;
  agentsWithQuestions: number;
  contextUsageMap: Map<number, ContextUsageState>;
  resolveModel: (agentType: AgentType) => string;
  resolveProvider: (agentType: AgentType) => string;
  handleModelChange: (agentType: AgentType, modelId: string) => void;
  handleProviderChange: (agentType: AgentType, providerId: string) => void;
  resolveModelThinkingEffort: (
    providerId: string,
    modelId: string,
  ) => ThinkingEffortLevel | undefined;
  setModelThinkingEffort: (
    providerId: string,
    modelId: string,
    effort: ThinkingEffortLevel | undefined,
  ) => void;
  handleDeleteAgent: (entry: FeatureSession) => void;
  onViewDiff: (entry: FeatureSession) => void;
  slashCommands: SlashCommand[];
  slashCommandsLoading: boolean;
}

export function WorkflowAgentGrid({
  backend,
  featureId,
  projectId,
  agentVisible,
  openAgent,
  setOpenAgent,
  maximizedAgent,
  setMaximizedAgent,
  setAgentRef,
  agentsWithQuestions,
  contextUsageMap,
  resolveModel,
  resolveProvider,
  handleModelChange,
  handleProviderChange,
  resolveModelThinkingEffort,
  setModelThinkingEffort,
  handleDeleteAgent,
  onViewDiff,
  slashCommands,
  slashCommandsLoading,
}: WorkflowAgentGridProps): ReactElement {
  // Single subscription for the whole grid: every entry derives its live
  // status from this map without each row opening its own selector.
  const bySession = useSessionStatusStore((s) => s.bySession);
  const enabledOptInModesByProvider = useEnabledOptInModesByProvider();
  const renderAgent = (entry: FeatureSession, index: number, isGridItem: boolean): ReactNode => {
    const liveStatus = liveStatusFor(entry, bySession);
    const knownLabel = AGENT_LABELS[entry.agentType as AgentType];
    const providerId = entry.runtimeProvider || resolveProvider(entry.agentType);
    const modelId = entry.model || resolveModel(entry.agentType);
    const isSessionAgent = entry.agentType === "session";
    const enabledOptInModes = isSessionAgent ? enabledOptInModesByProvider(providerId) : undefined;
    const handlePermissionModeToggle =
      isSessionAgent && backend.setAgentPermissionMode
        ? (): void => {
            const current = parsePermissionMode(entry.permissionMode) ?? "acceptEdits";
            const next = nextProviderMode(providerId, current, enabledOptInModes ?? []);
            if (next !== current) backend.setAgentPermissionMode?.(entry, next);
          }
        : undefined;
    const label = knownLabel
      ? (entry.agentType === "execute" || entry.agentType === "qa") && entry.phaseTitle
        ? `${knownLabel} - ${entry.phaseTitle}`
        : knownLabel
      : capitalize(entry.agentType);
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
        status={liveStatus}
        blocks={entry.blocks}
        open={openAgent === sessionKey || liveStatus !== "idle"}
        onToggle={() => {
          setOpenAgent((prev) => (prev === sessionKey ? null : sessionKey));
          if (openAgent !== sessionKey && entry.blocks.length === 0 && backend.loadAgentHistory) {
            backend.loadAgentHistory(entry);
          }
        }}
        maximized={isThisMaximized}
        onToggleMaximize={() =>
          setMaximizedAgent((prev) => (prev === sessionKey ? null : sessionKey))
        }
        pendingQuestions={questions.length > 0 ? questions : undefined}
        disableShortcuts={agentsWithQuestions > 1}
        permissionMode={entry.agentType === "session" ? entry.permissionMode : undefined}
        enabledOptInModes={enabledOptInModes}
        onPermissionModeToggle={handlePermissionModeToggle}
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
        onResume={
          entry.resumable
            ? () => void backend.handleResume(entry.agentType, entry.sessionDbId)
            : undefined
        }
        hasFileChanges={entry.hasFileChanges}
        onViewDiff={() => onViewDiff(entry)}
        todos={agentVisible ? entry.todos : null}
        agentTabActive={agentVisible}
        currentProviderId={providerId}
        onProviderChange={(newProviderId) => handleProviderChange(entry.agentType, newProviderId)}
        currentModelId={modelId}
        onModelChange={(_newProviderId, newModelId) =>
          handleModelChange(entry.agentType, newModelId)
        }
        currentThinkingEffort={resolveModelThinkingEffort(providerId, modelId)}
        onThinkingEffortChange={(effort) => setModelThinkingEffort(providerId, modelId, effort)}
        canDelete={
          entry.status !== "running" && entry.status !== "completed" && !!entry.sessionDbId
        }
        onDelete={() => handleDeleteAgent(entry)}
        contextUsage={contextUsageMap.get(entry.sessionDbId)}
        featureId={featureId}
        projectId={projectId}
        sessionId={entry.sessionDbId}
        runtimeProvider={entry.runtimeProvider || undefined}
        runtimeSessionId={entry.runtimeSessionId || undefined}
        slashCommandsOverride={slashCommands}
        slashCommandsLoading={slashCommandsLoading}
        initialDraft={entry.draftPrompt}
        pendingPermission={entry.pendingPermission}
        onPermissionDecision={(decision, feedback, optionId) =>
          backend.submitPermission(entry, decision, feedback, optionId)
        }
        pendingPlanApproval={entry.pendingPlanApproval}
        planApprovalError={backend.planApprovalError}
        planApproveLabel="Approve"
        onPlanApprove={() => backend.approvePlan(entry.subprocessId, entry.sessionDbId)}
        onPlanRequestChanges={(feedback: string) =>
          backend.rejectPlan(feedback, entry.subprocessId, entry.sessionDbId)
        }
        onPlanReject={() => {
          backend.rejectPlan("", entry.subprocessId, entry.sessionDbId);
          backend.stopAgent(entry);
        }}
        hasMore={entry.hasMore}
        onLoadOlder={
          backend.loadOlderMessages
            ? () => backend.loadOlderMessages!(entry.sessionDbId)
            : undefined
        }
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

  const activeEntries = backend.sessionEntries.filter(
    (e) => e.status === "running" || e.status === "paused",
  );
  const inactiveEntries = backend.sessionEntries.filter(
    (e) => e.status !== "running" && e.status !== "paused",
  );
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
