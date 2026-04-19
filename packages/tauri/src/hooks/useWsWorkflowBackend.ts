/** WebSocket workflow backend adapter — maps Zustand store state into FeatureSession[]. */

import { useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeatureSession } from "./useFeatureAgentState";
import { serverBlocksToAgentBlocks } from "./useFeatureAgentState";
import type { AgentType } from "../types/agent-types";
import type { FeatureAgentStateResponse } from "../api/generated";
import type { AgentStatus } from "@/types/agent";
import type { QueueItem, AgentSessionState, FeatureSnapshot } from "@/types/workflow";
import { PLAN_KEY, PRD_KEY } from "@/types/workflow";
import { useWorkflowStore } from "./useWorkflowWebSocket";
import { useGetFeatureAgentState } from "@/api/generated";
import { customInstance } from "@/api/client";
import { deriveViewState, type WorkflowBackend } from "./workflowBackendTypes";
import type { FeatureStatus } from "./useFeatureState";

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

const QUEUE_STATUS_MAP: Record<string, AgentStatus> = {
  running: "running", completed: "completed", error: "error", paused: "paused", skipped: "completed",
};

function toFeatureSession(
  agent: AgentSessionState | undefined,
  agentType: AgentType,
  item?: QueueItem,
): FeatureSession {
  const status = item
    ? (QUEUE_STATUS_MAP[item.status] ?? agent?.status ?? "idle") as AgentStatus
    : (agent?.status ?? "idle");
  return {
    sessionDbId: agent?.sessionId ?? item?.agent_session_id ?? (item ? -item.id : 0),
    agentType,
    status: item?.status === "running" ? (agent?.status ?? "running") : status,
    blocks: agent?.blocks ?? [],
    pendingPermission: agent?.pendingPermission ?? null,
    pendingQuestions: agent?.pendingQuestions?.length ? agent.pendingQuestions : null,
    hasFileChanges: agent?.hasFileChanges ?? false,
    resumable: item?.status === "paused" || agent?.status === "paused",
    phaseId: item?.phase_id ?? null,
    phaseTitle: item?.phase_title ?? null,
    subprocessId: null, model: null, runId: null, todos: null,
    runtimeSessionId: agent?.runtimeSessionId ?? null,
    permissionMode: "acceptEdits", pendingPlanApproval: agent?.pendingPlanApproval ?? null,
    inputTokens: agent?.inputTokens ?? 0,
    outputTokens: agent?.outputTokens ?? 0,
    contextWindow: agent?.contextWindow ?? null,
    wasCompacted: false, draftPrompt: null,
    hasMore: agent?.hasMore ?? false,
    oldestMessageId: agent?.oldestMessageId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Build session entries from store state
// ---------------------------------------------------------------------------

export function buildSessionEntries(
  queue: QueueItem[],
  agents: Map<string, AgentSessionState>,
  workflowStatus?: string,
): { sessions: FeatureSession[]; planSession: FeatureSession | null; prdSession: FeatureSession | null } {
  const planAgent = agents.get(PLAN_KEY) ?? null;
  const prdAgent = agents.get(PRD_KEY) ?? null;

  const planSession = planAgent ? toFeatureSession(planAgent, "plan") : null;
  const prdSession = prdAgent ? toFeatureSession(prdAgent, "prd") : null;

  if (workflowStatus === "plan_approval" && planSession) {
    planSession.pendingPlanApproval = {};
  }

  if (workflowStatus === "prd" && prdSession && prdAgent?.status === "paused") {
    prdSession.pendingPlanApproval = {};
  }

  const sessions: FeatureSession[] = [];

  // Add plan/prd sessions first, ordered by creation (lower sessionDbId = created first)
  const preSessions = [planSession, prdSession].filter(Boolean) as FeatureSession[];
  preSessions.sort((a, b) => a.sessionDbId - b.sessionDbId);
  sessions.push(...preSessions);

  // Add queue item sessions
  for (const item of queue) {
    const agentState = agents.get(`qi:${item.id}`);
    if (item.status === "running" || item.status === "completed" || item.status === "error" || item.status === "paused" || agentState) {
      sessions.push(toFeatureSession(agentState, item.item_type as AgentType, item));
    }
  }

  // Add agents not tied to queue items or plan/prd (session, risk, retro, review-fixer)
  for (const [key, agent] of agents) {
    if (key === PLAN_KEY || key === PRD_KEY) continue;
    if (key.startsWith("qi:")) continue;
    sessions.push(toFeatureSession(agent, agent.agentType as AgentType));
  }

  return { sessions, planSession, prdSession };
}

// ---------------------------------------------------------------------------
// Find slot key from a FeatureSession (reverse lookup)
// ---------------------------------------------------------------------------

export function findSlotKey(
  entry: FeatureSession,
  queue: QueueItem[],
  agents: Map<string, AgentSessionState>,
): string {
  if (entry.agentType === "plan") return PLAN_KEY;
  if (entry.agentType === "prd") return PRD_KEY;

  // Check agents for matching sessionId
  for (const [slotKey, agent] of agents) {
    if (agent.sessionId === entry.sessionDbId) return slotKey;
  }
  // Check queue for matching agent_session_id
  for (const item of queue) {
    if (item.agent_session_id === entry.sessionDbId) return `qi:${item.id}`;
  }
  // Fallback
  if (entry.sessionDbId < 0) return `qi:${-entry.sessionDbId}`;
  return `session:${entry.sessionDbId}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWsWorkflowBackend(
  featureId: number,
  projectId: number,
  featureStatus?: FeatureStatus,
  enabled = true,
): WorkflowBackend {
  const store = useWorkflowStore();
  const queryClient = useQueryClient();

  // `refetchOnMount: "always"` is critical here: navigating to another
  // feature wipes `useWorkflowStore` (single-global store), so when the user
  // returns we must re-hydrate with the CURRENT backend state — not the
  // cached snapshot from the first visit, which would miss every event
  // streamed in the meantime and leave the main view with an empty
  // transcript while the agent is still running.
  const { data: snapshot } = useQuery<FeatureSnapshot>({
    queryKey: ["feature-snapshot", featureId],
    queryFn: () =>
      customInstance<FeatureSnapshot>({
        url: `/api/features/${featureId}/snapshot`,
        method: "GET",
      }),
    enabled,
    staleTime: Infinity,
    refetchOnMount: "always",
    retry: 1,
  });

  // Eagerly load agent blocks from REST — runs in parallel with the
  // snapshot. `limit: 100` fetches the most recent 100 messages per session;
  // scroll-to-top in `AgentSession` triggers `loadOlderMessages` for older
  // pages via `/api/features/{id}/agent-state?before=…`.
  const agentStateQuery = useGetFeatureAgentState(featureId, undefined, {
    enabled: enabled && !store.hydrated,
    staleTime: Infinity,
    refetchOnMount: "always",
  }, 100);

  useEffect(() => {
    if (!enabled) return;
    store.connect(featureId, projectId);
    // No cleanup: feature→feature navigation is handled inside connect()'s
    // `prev.conn?.close()`. Leaving a feature for a non-feature route keeps
    // the WS alive so the sidebar + agent state stay in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId, projectId, enabled]);

  // Wait for BOTH snapshot AND agent-state before hydrating — prevents race conditions
  const hydrated = store.hydrated;
  useEffect(() => {
    if (snapshot && agentStateQuery.data && !hydrated) {
      store.hydrateFromSnapshot(snapshot, agentStateQuery.data);
    } else if (snapshot && agentStateQuery.isError && !hydrated) {
      // If agent-state fetch fails, hydrate without blocks (fallback to lazy loading)
      store.hydrateFromSnapshot(snapshot);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, agentStateQuery.data, agentStateQuery.isError, hydrated]);

  const isHydrating = enabled && !store.hydrated;

  const { sessions, planSession, prdSession } = useMemo(
    () => buildSessionEntries(store.queue, store.agents, store.workflowStatus),
    [store.queue, store.agents, store.workflowStatus],
  );

  const isLoading = isHydrating;

  const hasAnyAgentOutput = sessions.some((s) => s.blocks.length > 0);
  const noAgentsRunning = !sessions.some((s) => s.status === "running");
  const view = deriveViewState(store.workflowStatus, sessions);

  const historyFetchInFlight = useRef(false);

  const loadAgentHistory = useCallback((entry: FeatureSession) => {
    if (entry.sessionDbId <= 0) return;
    if (historyFetchInFlight.current) return;

    const storeState = useWorkflowStore.getState();
    const slotKey = findSlotKey(entry, storeState.queue, storeState.agents);
    const agent = storeState.agents.get(slotKey);
    if (agent && (agent.historyLoaded || agent.blocks.length > 0)) return;

    historyFetchInFlight.current = true;

    customInstance<FeatureAgentStateResponse>({
      url: `/api/features/${featureId}/agent-state`,
      method: "GET",
      params: { limit: 100 },
    }).then((resp) => {
      for (const session of resp.sessions) {
        if (session.blocks.length === 0) continue;
        const blocks = serverBlocksToAgentBlocks(session.blocks as never[]);
        const state = useWorkflowStore.getState();
        // Find the slot key for this session
        for (const [key, a] of state.agents) {
          if (a.sessionId === session.sessionDbId) {
            storeState.populateAgentBlocks(key, blocks, session.hasMore, session.oldestMessageId);
            break;
          }
        }
      }
    }).catch(() => {
      // Silently ignore — user can retry by collapsing/expanding
    }).finally(() => {
      historyFetchInFlight.current = false;
    });
  }, [featureId]);

  return {
    workflowStatus: store.workflowStatus,
    sessionEntries: sessions,
    planSession,
    prdSession,
    queue: store.queue,
    autonomyLevel: store.autonomyLevel,
    error: store.error,
    clearError: store.clearError,

    actions: (() => {
      const notArchived = featureStatus !== "archived";
      const ws = store.workflowStatus;
      const hasActiveWorkflow = ws === "ready_to_build" || ws === "building" || ws === "paused" || ws === "completed" || ws === "error";
      return {
        canStartPlan: notArchived && (ws === "idle" || ws === "planning"),
        canStartPrd: notArchived && ws === "idle",
        canStartBuild: notArchived && ws === "ready_to_build",
        canStartRisk: notArchived && hasActiveWorkflow,
        canStartReview: false,
        canStartWorkflowSession: notArchived && hasActiveWorkflow,
        canStartRefine: notArchived && hasActiveWorkflow,
        canStartRetro: ws === "completed",
      };
    })(),

    hasAnyAgentOutput,
    noAgentsRunning,
    view: isLoading ? "loading" as const : view,
    isLoading,

    isStartingPlan: false,
    isStartingPrd: false,
    isStartingExecute: store.startingBuild,
    isStartingRisk: false,
    isStartingReview: false,
    isStartingRetro: false,
    isContinuingBuild: store.continuingBuild,
    isStartingWorkflowSession: store.startingSession,
    isStartingRefinePlan: false,
    canContinueBuild: store.workflowStatus === "paused" && noAgentsRunning,
    executeWaitingNextStep: null,
    executeStatus: "idle" as const,
    planApprovalError: null,

    startPlan: (description, images) => store.startPlan(description, images),
    startPrd: (description, images) => store.startPrd(description, images),
    approvePlan: (_subprocessId, _sessionDbId, requestId) => store.approvePlan(requestId ?? undefined),
    rejectPlan: (feedback, _subprocessId, _sessionDbId, requestId) => store.rejectPlan(feedback, requestId ?? undefined),
    startBuilding: () => store.startBuild(),
    continueWorkflow: () => store.continueWorkflow(),
    sendToAgent: (entry, message, images) => {
      const slotKey = findSlotKey(entry, store.queue, store.agents);
      store.sendPromptToAgent(slotKey, message, images);
    },
    stopAgent: (entry) => {
      const slotKey = findSlotKey(entry, store.queue, store.agents);
      store.interruptItem(slotKey);
    },
    interruptAgent: (entry) => {
      const slotKey = findSlotKey(entry, store.queue, store.agents);
      store.interruptItem(slotKey);
    },
    submitPermission: (entry, decision, feedback) => {
      const slotKey = findSlotKey(entry, store.queue, store.agents);
      const requestId = entry.pendingPermission?.requestId ?? "";
      const mapped = decision === "allow" ? "allow_once" : decision === "deny" ? "deny" : "allow_future";
      store.respondToPermission(slotKey, requestId, mapped as "allow_once" | "allow_future" | "deny", feedback);
    },
    submitAnswers: (entry, response) => {
      const slotKey = findSlotKey(entry, store.queue, store.agents);
      store.respondToQuestion(slotKey, response);
    },
    startSession: (prompt, images) => store.startSession(prompt, images?.map(i => ({ base64: i, mimeType: "image/png" }))),
    startRefine: (description, images) => store.startRefine(description, images?.map(i => ({ base64: i, mimeType: "image/png" }))),
    startRisk: () => store.startRisk(),
    startReview: () => { /* WS workflow handles review via queue */ },
    startRetro: () => store.startRetro(),
    startReviewFixer: (comments) => store.startReviewFixer(comments),
    markDone: (sessionDbId) => {
      for (const [slotKey, agent] of store.agents) {
        if (agent.sessionId === sessionDbId) {
          store.markDone(slotKey);
          return;
        }
      }
      store.markDone(`session:${sessionDbId}`);
    },
    deleteSession: (sessionDbId) => {
      store.deleteSession(sessionDbId);
      void queryClient.invalidateQueries({ queryKey: ["feature-snapshot", featureId] });
    },
    handleResume: (_agentType, sessionDbId) => {
      const entry = sessions.find(s => s.sessionDbId === sessionDbId);
      if (!entry) return;
      const slotKey = findSlotKey(entry, store.queue, store.agents);
      store.resumeItem(slotKey);
    },

    loadAgentHistory,

    loadOlderMessages: async (sessionDbId: number) => {
      const state = useWorkflowStore.getState();
      let agent: AgentSessionState | undefined;
      let slotKey: string | undefined;
      for (const [key, a] of state.agents) {
        if (a.sessionId === sessionDbId) {
          agent = a;
          slotKey = key;
          break;
        }
      }
      if (!agent || !agent.hasMore || agent.oldestMessageId == null || slotKey == null) return;

      const beforeParam = JSON.stringify({ [sessionDbId]: agent.oldestMessageId });
      const resp = await customInstance<FeatureAgentStateResponse>({
        url: `/api/features/${featureId}/agent-state`,
        method: "GET",
        params: { before: beforeParam, limit: 100 },
      });

      const serverSession = resp.sessions.find((s) => s.sessionDbId === sessionDbId);
      if (!serverSession || serverSession.blocks.length === 0) {
        state.populateOlderBlocks(slotKey, [], false, null);
        return;
      }

      const olderBlocks = serverBlocksToAgentBlocks(serverSession.blocks as never[]);
      state.populateOlderBlocks(slotKey, olderBlocks, serverSession.hasMore, serverSession.oldestMessageId);
    },

    skipItem: (itemId) => store.skipItem(itemId),
    retryItem: (itemId) => store.retryItem(itemId),
    setAutonomyLevel: (level) => store.setAutonomyLevel(level),
    setParallelExecution: (enabled) => store.setParallelExecution(enabled),
    selectItem: (itemId) => store.selectItem(itemId),
    selectedItemId: store.selectedItemId,

    worktreeStatus: store.worktreeStatus,
    worktreePath: store.worktreePath,
    worktreeBranch: store.worktreeBranch,
    worktreeSetupOutput: store.worktreeSetupOutput,
    worktreeError: store.worktreeError,
  };
}
