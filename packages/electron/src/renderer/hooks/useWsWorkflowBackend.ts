/**
 * WebSocket workflow backend adapter.
 *
 * Implements WorkflowBackend by wrapping the Zustand useWorkflowStore,
 * mapping queue items + active agent sessions into FeatureSession[].
 */

import { useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FeatureSession } from "./useFeatureAgentState";
import { serverBlocksToAgentBlocks } from "./useFeatureAgentState";
import type { AgentType } from "../../main/agents/types";
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
      return agentStatus === "running" ? "running" : (agentStatus ?? "running");
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
    hasFileChanges: false,
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
    inputTokens: 0,
    outputTokens: 0,
    contextWindow: 200000,
    wasCompacted: false,
    draftPrompt: null,
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
    hasFileChanges: false,
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
    inputTokens: 0,
    outputTokens: 0,
    contextWindow: 200000,
    wasCompacted: false,
    draftPrompt: null,
  };
}

// ---------------------------------------------------------------------------
// Build session entries from store state
// ---------------------------------------------------------------------------

function buildSessionEntries(
  queue: QueueItem[],
  activeAgents: Map<number, AgentSessionState>,
  planAgent: AgentSessionState | null,
  prdAgent: AgentSessionState | null,
): { sessions: FeatureSession[]; planSession: FeatureSession | null; prdSession: FeatureSession | null } {
  const planSession = planAgent ? agentStateToFeatureSession(planAgent, "plan") : null;
  const prdSession = prdAgent ? agentStateToFeatureSession(prdAgent, "prd") : null;

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
  const planKey = AGENT_TYPE_SYNTHETIC_KEYS.plan;
  const prdKey = AGENT_TYPE_SYNTHETIC_KEYS.prd;
  const reviewFixerKey = AGENT_TYPE_SYNTHETIC_KEYS["review-fixer"];
  for (const [key, agent] of activeAgents) {
    if (key < 0 && key !== planKey && key !== prdKey) {
      const agentType: AgentType = key === reviewFixerKey ? "review-fixer" : "session";
      sessions.push(agentStateToFeatureSession(agent, agentType));
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
    () => buildSessionEntries(store.queue, store.activeAgents, store.planAgent, store.prdAgent),
    [store.queue, store.activeAgents, store.planAgent, store.prdAgent],
  );

  const hasAnyAgentOutput = sessions.some((s) => s.blocks.length > 0);
  const noAgentsRunning = !sessions.some((s) => s.status === "running");
  const view = deriveViewState(store.workflowStatus, sessions);

  // In-flight guard: prevents duplicate API calls while a fetch is pending
  const historyFetchInFlight = useRef(false);

  const loadAgentHistory = useCallback((entry: FeatureSession) => {
    const storeState = useWorkflowStore.getState();
    const itemId = findQueueItemId(entry, storeState.queue, storeState.activeAgents);
    const agent = resolveAgentByItemId(storeState, itemId);
    if (!agent || agent.historyLoaded || agent.blocks.length > 0) return;
    if (agent.sessionId <= 0) return;
    if (historyFetchInFlight.current) return;

    historyFetchInFlight.current = true;

    customInstance<FeatureAgentStateResponse>({
      url: `/api/features/${featureId}/agent-state`,
      method: "GET",
    }).then((resp) => {
      // Single API call returns all sessions — distribute blocks to all agents
      for (const session of resp.sessions) {
        if (session.blocks.length === 0) continue;
        const blocks = serverBlocksToAgentBlocks(session.blocks as never[]);
        // Find the item ID for this session
        const state = useWorkflowStore.getState();
        for (const [id, a] of state.activeAgents) {
          if (a.sessionId === session.sessionDbId) {
            storeState.populateAgentBlocks(id, blocks);
            break;
          }
        }
        // Also check plan/prd slots
        if (state.planAgent?.sessionId === session.sessionDbId) {
          storeState.populateAgentBlocks(AGENT_TYPE_SYNTHETIC_KEYS.plan, blocks);
        }
        if (state.prdAgent?.sessionId === session.sessionDbId) {
          storeState.populateAgentBlocks(AGENT_TYPE_SYNTHETIC_KEYS.prd, blocks);
        }
      }
    }).catch(() => {
      // Silently ignore — user can retry by collapsing/expanding
    }).finally(() => {
      historyFetchInFlight.current = false;
    });
  }, [featureId]);

  // Review verdict: check if any review item has changes_requested result
  const reviewVerdict = store.queue.some(
    (q) => q.item_type === "review" && q.result === "changes_requested",
  )
    ? ("changes_requested" as const)
    : null;

  return {
    // Read state
    workflowStatus: store.workflowStatus,
    sessionEntries: sessions,
    planSession,
    prdSession,
    reviewVerdict,
    queue: store.queue,
    autonomyLevel: store.autonomyLevel,
    error: store.error,

    // Action availability (WS workflow manages its own state machine)
    actions: {
      canStartPlan: store.workflowStatus === "idle",
      canStartPrd: store.workflowStatus === "idle",
      canStartBuild: store.workflowStatus === "plan_approval",
      canStartRisk: false,
      canStartReview: false,
      canStartWorkflowSession: store.workflowStatus !== "idle",
      canStartRefine: store.workflowStatus !== "idle",
      canStartRetro: store.workflowStatus === "completed",
    },

    // Derived
    hasAnyAgentOutput,
    noAgentsRunning,
    view: isHydrating ? "loading" as const : view,
    isLoading: isHydrating,

    // Loading flags (WS actions are fire-and-forget)
    isStartingPlan: false,
    isStartingPrd: false,
    isStartingExecute: false,
    isStartingRisk: false,
    isStartingReview: false,
    isStartingRetro: false,
    isStartingFix: false,
    isContinuingBuild: false,
    isStartingWorkflowSession: false,
    isStartingRefinePlan: false,
    isAddingFixPhase: false,
    canContinueBuild: false,
    executeWaitingNextStep: null,
    executeStatus: "idle" as const,
    planApprovalError: null,

    // Commands
    startPlan: (description, images) => store.startPlan(description, images?.map(i => ({ base64: i, mimeType: "image/png" }))),
    startPrd: (description, images) => store.startPrd(description, images?.map(i => ({ base64: i, mimeType: "image/png" }))),
    approvePlan: (_subprocessId, _sessionDbId, requestId) => store.approvePlan(requestId ?? undefined),
    rejectPlan: (feedback, _subprocessId, _sessionDbId, requestId) => store.rejectPlan(feedback, requestId ?? undefined),
    startBuilding: () => store.startBuild(),
    continueWorkflow: () => store.continueWorkflow(),
    sendToAgent: (entry, message, images) => {
      const itemId = findQueueItemId(entry, store.queue, store.activeAgents);
      store.sendPromptToAgent(itemId, message, images?.map(i => ({ base64: i, mimeType: "image/png" })));
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
    startRisk: () => { /* WS workflow handles risk via queue */ },
    startReview: () => { /* WS workflow handles review via queue */ },
    startRetro: () => { /* WS workflow handles retro via queue */ },
    startReviewFixer: (comments) => store.startReviewFixer(comments),
    addFixPhase: undefined,
    fixImmediately: undefined,
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
      for (const [itemId, agent] of store.activeAgents) {
        if (agent.sessionId === sessionDbId) {
          store.removeAgent(itemId);
          return;
        }
      }
      store.removeAgent(sessionDbId);
    },
    handleResume: (_agentType, sessionDbId) => {
      const entry = sessions.find(s => s.sessionDbId === sessionDbId);
      if (!entry) return;
      const itemId = findQueueItemId(entry, store.queue, store.activeAgents);
      store.resumeItem(itemId);
    },

    // Lazy history loading
    loadAgentHistory,

    // Queue-specific
    skipItem: (itemId) => store.skipItem(itemId),
    retryItem: (itemId) => store.retryItem(itemId),
    setAutonomyLevel: (level) => store.setAutonomyLevel(level),
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
