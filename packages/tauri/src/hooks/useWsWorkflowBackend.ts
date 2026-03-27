/**
 * WebSocket workflow backend adapter.
 *
 * Implements WorkflowBackend by wrapping the Zustand useWorkflowStore,
 * mapping queue items + active agent sessions into FeatureSession[].
 */

import { useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeatureSession } from "./useFeatureAgentState";
import { serverBlocksToAgentBlocks } from "./useFeatureAgentState";
import type { AgentType } from "../types/agent-types";
import type { FeatureAgentStateResponse } from "../api/generated";
import type { AgentStatus } from "@/types/agent";
import {
  useWorkflowStore,
  AGENT_TYPE_SYNTHETIC_KEYS,
  resolveAgentByItemId,
  type QueueItem,
  type QueueItemStatus,
  type AgentSessionState,
  type FeatureSnapshot,
} from "./useWorkflowWebSocket";
import { customInstance } from "@/api/client";
import { deriveViewState, type WorkflowBackend } from "./workflowBackendTypes";

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapItemTypeToAgentType(itemType: string): AgentType {
  switch (itemType) {
    case "execute":
    case "plan":
    case "prd":
    case "qa":
    case "review":
    case "risk":
    case "retro":
    case "session":
      return itemType as AgentType;
    case "review-fixer":
    case "review_fixer":
      return "review-fixer";
    default:
      return "execute";
  }
}

function mapQueueStatusToAgentStatus(
  queueStatus: QueueItemStatus,
  agentStatus: AgentStatus | undefined,
): AgentStatus {
  switch (queueStatus) {
    case "running":
      return agentStatus ?? "running";
    case "completed":
      return "completed";
    case "error":
      return "error";
    case "paused":
      return "paused";
    case "skipped":
      return "completed";
    default:
      // pending, blocked, ready
      return "idle";
  }
}

function queueItemToFeatureSession(
  item: QueueItem,
  agentState: AgentSessionState | undefined,
): FeatureSession {
  return {
    sessionDbId: agentState?.sessionId ?? item.agent_session_id ?? -item.id,
    agentType: mapItemTypeToAgentType(item.item_type),
    status: mapQueueStatusToAgentStatus(item.status, agentState?.status),
    blocks: agentState?.blocks ?? [],
    pendingPermission: agentState?.pendingPermission ?? null,
    pendingQuestions: agentState?.pendingQuestions?.length ? agentState.pendingQuestions : null,
    hasFileChanges: agentState?.hasFileChanges ?? false,
    resumable: item.status === "paused" || agentState?.status === "paused",
    phaseId: item.phase_id,
    phaseTitle: item.phase_title,
    subprocessId: null,
    model: null,
    claudeSessionId: agentState?.claudeSessionId ?? null,
    runId: null,
    todos: null,
    permissionMode: "acceptEdits",
    pendingPlanApproval: null,
    inputTokens: agentState?.inputTokens ?? 0,
    outputTokens: agentState?.outputTokens ?? 0,
    contextWindow: agentState?.contextWindow ?? 200_000,
    wasCompacted: false,
    draftPrompt: null,
    hasMore: agentState?.hasMore ?? false,
    oldestMessageId: agentState?.oldestMessageId ?? null,
  };
}

function agentStateToFeatureSession(
  agentState: AgentSessionState,
  agentType: AgentType,
): FeatureSession {
  return {
    sessionDbId: agentState.sessionId,
    agentType,
    status: agentState.status,
    blocks: agentState.blocks,
    pendingPermission: agentState.pendingPermission,
    pendingQuestions: agentState?.pendingQuestions?.length ? agentState.pendingQuestions : null,
    hasFileChanges: agentState.hasFileChanges,
    resumable: agentState.status === "paused",
    phaseId: null,
    phaseTitle: null,
    subprocessId: null,
    model: null,
    claudeSessionId: agentState.claudeSessionId ?? null,
    runId: null,
    todos: null,
    permissionMode: "acceptEdits",
    pendingPlanApproval: null,
    inputTokens: agentState.inputTokens,
    outputTokens: agentState.outputTokens,
    contextWindow: agentState.contextWindow,
    wasCompacted: false,
    draftPrompt: null,
    hasMore: agentState.hasMore ?? false,
    oldestMessageId: agentState.oldestMessageId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Build session entries from store state
// ---------------------------------------------------------------------------

export function buildSessionEntries(
  queue: QueueItem[],
  activeAgents: Map<number, AgentSessionState>,
  planAgent: AgentSessionState | null,
  prdAgent: AgentSessionState | null,
  workflowStatus?: string,
): { sessions: FeatureSession[]; planSession: FeatureSession | null; prdSession: FeatureSession | null } {
  const planSession = planAgent ? agentStateToFeatureSession(planAgent, "plan") : null;
  const prdSession = prdAgent ? agentStateToFeatureSession(prdAgent, "prd") : null;

  // When the workflow is in plan_approval state, set pendingPlanApproval on the
  // plan agent session so the approval bar renders in the AgentPromptBar.
  if (workflowStatus === "plan_approval" && planSession) {
    planSession.pendingPlanApproval = {};
  }

  // When the PRD agent is paused (prd_ready fired) and workflow is in "prd" state,
  // set pendingPlanApproval on the PRD session so the approval bar renders.
  if (workflowStatus === "prd" && prdSession && prdAgent?.status === "paused") {
    prdSession.pendingPlanApproval = {};
  }

  const sessions: FeatureSession[] = [];

  // Add plan/prd sessions first
  if (planSession) sessions.push(planSession);
  if (prdSession) sessions.push(prdSession);

  // Add queue item sessions (running, completed, error — anything with visible state)
  for (const item of queue) {
    const agentState = activeAgents.get(item.id);
    if (item.status === "running" || item.status === "completed" || item.status === "error" || item.status === "paused" || agentState) {
      sessions.push(queueItemToFeatureSession(item, agentState));
    }
  }

  // Add agents not tied to queue items (negative synthetic keys; plan/prd handled above)
  for (const [key, agent] of activeAgents) {
    if (key < 0) {
      sessions.push(agentStateToFeatureSession(agent, agent.agentType as AgentType));
    }
  }

  return { sessions, planSession, prdSession };
}

// ---------------------------------------------------------------------------
// Find queue item ID from a FeatureSession (reverse lookup)
// ---------------------------------------------------------------------------

export function findQueueItemId(
  entry: FeatureSession,
  queue: QueueItem[],
  activeAgents: Map<number, AgentSessionState>,
): number {
  // Pre-queue agents use fixed synthetic IDs on the backend
  if (entry.agentType === "plan") return -1;
  if (entry.agentType === "prd") return -2;

  // Check activeAgents for matching sessionId
  for (const [itemId, agent] of activeAgents) {
    if (agent.sessionId === entry.sessionDbId) return itemId;
  }
  // Check queue for matching agent_session_id
  for (const item of queue) {
    if (item.agent_session_id === entry.sessionDbId) return item.id;
  }
  // Fallback: negative sessionDbId means -item.id was used
  if (entry.sessionDbId < 0) return -entry.sessionDbId;
  return entry.sessionDbId;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWsWorkflowBackend(
  featureId: number,
  projectId: number,
  enabled = true,
): WorkflowBackend {
  const store = useWorkflowStore();
  const queryClient = useQueryClient();

  // Fetch snapshot in parallel with WS connect
  const { data: snapshot } = useQuery<FeatureSnapshot>({
    queryKey: ["feature-snapshot", featureId],
    queryFn: () =>
      customInstance<FeatureSnapshot>({
        url: `/api/features/${featureId}/snapshot`,
        method: "GET",
      }),
    enabled,
    staleTime: Infinity, // Only fetch once
    retry: 1,
  });

  useEffect(() => {
    if (!enabled) return;
    store.connect(featureId, projectId);
    return () => store.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId, projectId, enabled]);

  // Hydrate store from snapshot when it arrives.
  // We also depend on `store.hydrated` so that when the component remounts
  // (navigating back to the same feature) and `connect()` has reset
  // `hydrated` to false, we re-hydrate from the cached snapshot even though
  // the snapshot reference hasn't changed (staleTime: Infinity).
  const hydrated = store.hydrated;
  useEffect(() => {
    if (snapshot && !hydrated) {
      store.hydrateFromSnapshot(snapshot);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, hydrated]);

  const isHydrating = enabled && !store.hydrated;

  const { sessions, planSession, prdSession } = useMemo(
    () => buildSessionEntries(store.queue, store.activeAgents, store.planAgent, store.prdAgent, store.workflowStatus),
    [store.queue, store.activeAgents, store.planAgent, store.prdAgent, store.workflowStatus],
  );

  // Still loading if hydrated but sessions need history (blocks empty, not yet fetched).
  // This prevents a flash of empty agent cards before conversation blocks arrive.
  const needsHistory = !isHydrating && sessions.length > 0 && sessions.some(
    (s) => (s.status === "paused" || s.status === "running") && s.blocks.length === 0,
  );
  const isLoading = isHydrating || needsHistory;

  const hasAnyAgentOutput = sessions.some((s) => s.blocks.length > 0);
  const noAgentsRunning = !sessions.some((s) => s.status === "running");
  const view = deriveViewState(store.workflowStatus, sessions);

  // In-flight guard: prevents duplicate API calls while a fetch is pending
  const historyFetchInFlight = useRef(false);

  const loadAgentHistory = useCallback((entry: FeatureSession) => {
    if (entry.sessionDbId <= 0) return;
    if (historyFetchInFlight.current) return;

    // Skip if the agent already exists in the store and has history/blocks.
    // The agent may not be in activeAgents yet (queue_update arrives before
    // agent.started), so a missing agent must NOT block the fetch.
    const storeState = useWorkflowStore.getState();
    const itemId = findQueueItemId(entry, storeState.queue, storeState.activeAgents);
    const agent = resolveAgentByItemId(storeState, itemId);
    if (agent && (agent.historyLoaded || agent.blocks.length > 0)) return;

    historyFetchInFlight.current = true;

    customInstance<FeatureAgentStateResponse>({
      url: `/api/features/${featureId}/agent-state`,
      method: "GET",
      params: { limit: 100 },
    }).then((resp) => {
      // Single API call returns all sessions — distribute blocks to all agents
      for (const session of resp.sessions) {
        if (session.blocks.length === 0) continue;
        const blocks = serverBlocksToAgentBlocks(session.blocks as never[]);
        // Find the item ID for this session
        const state = useWorkflowStore.getState();
        for (const [id, a] of state.activeAgents) {
          if (a.sessionId === session.sessionDbId) {
            storeState.populateAgentBlocks(id, blocks, session.hasMore, session.oldestMessageId);
            break;
          }
        }
        // Also check plan/prd slots
        if (state.planAgent?.sessionId === session.sessionDbId) {
          storeState.populateAgentBlocks(AGENT_TYPE_SYNTHETIC_KEYS.plan, blocks, session.hasMore, session.oldestMessageId);
        }
        if (state.prdAgent?.sessionId === session.sessionDbId) {
          storeState.populateAgentBlocks(AGENT_TYPE_SYNTHETIC_KEYS.prd, blocks, session.hasMore, session.oldestMessageId);
        }
      }
    }).catch(() => {
      // Silently ignore — user can retry by collapsing/expanding
    }).finally(() => {
      historyFetchInFlight.current = false;
    });
  }, [featureId]);

  return {
    // Read state
    workflowStatus: store.workflowStatus,
    sessionEntries: sessions,
    planSession,
    prdSession,
    queue: store.queue,
    autonomyLevel: store.autonomyLevel,
    error: store.error,
    clearError: store.clearError,

    // Action availability (WS workflow manages its own state machine)
    actions: {
      canStartPlan: store.workflowStatus === "idle",
      canStartPrd: store.workflowStatus === "idle",
      canStartBuild: store.workflowStatus === "ready_to_build",
      canStartRisk: store.workflowStatus === "ready_to_build" || store.workflowStatus === "building" || store.workflowStatus === "paused" || store.workflowStatus === "completed" || store.workflowStatus === "error",
      canStartReview: false,
      canStartWorkflowSession: store.workflowStatus === "ready_to_build" || store.workflowStatus === "building" || store.workflowStatus === "paused" || store.workflowStatus === "completed" || store.workflowStatus === "error",
      canStartRefine: store.workflowStatus === "ready_to_build" || store.workflowStatus === "building" || store.workflowStatus === "paused" || store.workflowStatus === "completed" || store.workflowStatus === "error",
      canStartRetro: store.workflowStatus === "completed",
    },

    // Derived
    hasAnyAgentOutput,
    noAgentsRunning,
    view: isLoading ? "loading" as const : view,
    isLoading,

    // Loading flags (WS actions are fire-and-forget)
    isStartingPlan: false,
    isStartingPrd: false,
    isStartingExecute: store.startingBuild,
    isStartingRisk: false,
    isStartingReview: false,
    isStartingRetro: false,
    isContinuingBuild: store.continuingBuild,
    isStartingWorkflowSession: false,
    isStartingRefinePlan: false,
    canContinueBuild: store.workflowStatus === "paused" && noAgentsRunning,
    executeWaitingNextStep: null,
    executeStatus: "idle" as const,
    planApprovalError: null,

    // Commands
    startPlan: (description, images) => store.startPlan(description, images),
    startPrd: (description, images) => store.startPrd(description, images),
    approvePlan: (_subprocessId, _sessionDbId, requestId) => store.approvePlan(requestId ?? undefined),
    rejectPlan: (feedback, _subprocessId, _sessionDbId, requestId) => store.rejectPlan(feedback, requestId ?? undefined),
    startBuilding: () => store.startBuild(),
    continueWorkflow: () => store.continueWorkflow(),
    sendToAgent: (entry, message, images) => {
      const itemId = findQueueItemId(entry, store.queue, store.activeAgents);
      store.sendPromptToAgent(itemId, message, images);
    },
    stopAgent: (entry) => {
      const itemId = findQueueItemId(entry, store.queue, store.activeAgents);
      store.interruptItem(itemId);
    },
    // In WS workflow, stop and interrupt are the same (SIGINT → pause)
    interruptAgent: (entry) => {
      const itemId = findQueueItemId(entry, store.queue, store.activeAgents);
      store.interruptItem(itemId);
    },
    submitPermission: (entry, decision, _feedback) => {
      const itemId = findQueueItemId(entry, store.queue, store.activeAgents);
      const requestId = entry.pendingPermission?.requestId ?? "";
      const mapped = decision === "allow" ? "allow_once" : decision === "deny" ? "deny" : "allow_once";
      store.respondToPermission(itemId, requestId, mapped as "allow_once" | "allow_future" | "deny");
    },
    submitAnswers: (entry, response) => {
      const itemId = findQueueItemId(entry, store.queue, store.activeAgents);
      store.respondToQuestion(itemId, response);
    },
    startSession: (prompt, images) => store.startSession(prompt, images?.map(i => ({ base64: i, mimeType: "image/png" }))),
    startRefine: (description, images) => store.startRefine(description, images?.map(i => ({ base64: i, mimeType: "image/png" }))),
    startRisk: () => store.startRisk(),
    startReview: () => { /* WS workflow handles review via queue */ },
    startRetro: () => store.startRetro(),
    startReviewFixer: (comments) => store.startReviewFixer(comments),
    markDone: (sessionDbId) => {
      // Find the queue item for this session and mark it done
      for (const [itemId, agent] of store.activeAgents) {
        if (agent.sessionId === sessionDbId) {
          store.markDone(itemId);
          return;
        }
      }
      store.markDone(sessionDbId);
    },
    deleteSession: (sessionDbId) => {
      store.deleteSession(sessionDbId);
      void queryClient.invalidateQueries({ queryKey: ["feature-snapshot", featureId] });
    },
    handleResume: (_agentType, sessionDbId) => {
      const entry = sessions.find(s => s.sessionDbId === sessionDbId);
      if (!entry) return;
      const itemId = findQueueItemId(entry, store.queue, store.activeAgents);
      store.resumeItem(itemId);
    },

    // Lazy history loading
    loadAgentHistory,

    // Pagination: load older messages
    loadOlderMessages: async (sessionDbId: number) => {
      const state = useWorkflowStore.getState();
      // Find the agent with this sessionDbId to get oldestMessageId
      let agent: AgentSessionState | undefined;
      let itemId: number | undefined;
      if (state.planAgent?.sessionId === sessionDbId) {
        agent = state.planAgent;
        itemId = AGENT_TYPE_SYNTHETIC_KEYS.plan;
      } else if (state.prdAgent?.sessionId === sessionDbId) {
        agent = state.prdAgent;
        itemId = AGENT_TYPE_SYNTHETIC_KEYS.prd;
      } else {
        for (const [id, a] of state.activeAgents) {
          if (a.sessionId === sessionDbId) {
            agent = a;
            itemId = id;
            break;
          }
        }
      }
      if (!agent || !agent.hasMore || agent.oldestMessageId == null || itemId == null) return;

      const beforeParam = JSON.stringify({ [sessionDbId]: agent.oldestMessageId });
      const resp = await customInstance<FeatureAgentStateResponse>({
        url: `/api/features/${featureId}/agent-state`,
        method: "GET",
        params: { before: beforeParam, limit: 100 },
      });

      const serverSession = resp.sessions.find((s) => s.sessionDbId === sessionDbId);
      if (!serverSession || serverSession.blocks.length === 0) {
        state.populateOlderBlocks(itemId, [], false, null);
        return;
      }

      const olderBlocks = serverBlocksToAgentBlocks(serverSession.blocks as never[]);
      state.populateOlderBlocks(itemId, olderBlocks, serverSession.hasMore, serverSession.oldestMessageId);
    },

    // Queue-specific
    skipItem: (itemId) => store.skipItem(itemId),
    retryItem: (itemId) => store.retryItem(itemId),
    setAutonomyLevel: (level) => store.setAutonomyLevel(level),
    setParallelExecution: (enabled) => store.setParallelExecution(enabled),
    selectItem: (itemId) => store.selectItem(itemId),
    selectedItemId: store.selectedItemId,

    // Worktree state
    worktreeStatus: store.worktreeStatus,
    worktreePath: store.worktreePath,
    worktreeBranch: store.worktreeBranch,
    worktreeSetupOutput: store.worktreeSetupOutput,
    worktreeError: store.worktreeError,
  };
}
