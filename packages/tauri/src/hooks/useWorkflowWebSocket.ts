/**
 * Zustand store for workflow-specific WebSocket state.
 *
 * Manages the queue, active agent sessions, and workflow lifecycle.
 * Reuses processSdkMessage / applyMutations from ws-session-store for
 * all SDK message parsing — no duplication.
 */

import { create } from "zustand";
import { getWsUrl } from "@/lib/ws-url";
import { createCommandsGet, createPhaseApproval, createPhaseTrigger, createCustomWorkflowStart } from "@/lib/ws-envelope";
import {
  createWorkflowMessageHandler,
  itemIdToSlot,
  resolveAgentByItemId,
  patchAgentByItemId,
  blocksContainFileChange,
} from "@/hooks/workflow-event-handlers";
export { resolveAgentByItemId } from "@/hooks/workflow-event-handlers";
import {
  hydrateFromSnapshotPatch,
  computeSendPromptPatch,
  computeRespondToQuestionClearPatch,
} from "@/hooks/workflow-store-helpers";
import {
  type WorkflowStatus,
  type QueueItemStatus,
  type QueueItem,
  type AgentSessionState,
  type AutonomyLevel,
  type WorktreeStatus,
  type AgentSessionSummary,
  type PlanSnapshot,
  type WorktreeSnapshot,
  type FeatureSnapshot,
  type WorkflowState,
  type PhaseState,
  type PendingApproval,
  type AgentSlot,
  agentSlotKey,
  agentSlotToLegacyId,
  AGENT_TYPE_SYNTHETIC_KEYS,
  PLAN_KEY,
  PRD_KEY,
} from "@/types/workflow";

// Re-export types and constants for backward compatibility
export type {
  WorkflowStatus,
  QueueItemStatus,
  QueueItem,
  AgentSessionState,
  AutonomyLevel,
  WorktreeStatus,
  AgentSessionSummary,
  PlanSnapshot,
  WorktreeSnapshot,
  FeatureSnapshot,
  WorkflowState,
  AgentSlot,
  PhaseState,
  PendingApproval,
};
export {
  agentSlotKey,
  agentSlotToLegacyId,
  AGENT_TYPE_SYNTHETIC_KEYS,
};

export const useWorkflowStore = create<WorkflowState>((set, get) => {
  function send(action: string, payload: Record<string, unknown> = {}): boolean {
    const { ws, featureId } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        id: crypto.randomUUID(),
        domain: "workflow",
        action,
        payload: { feature_id: featureId, ...payload },
      }));
      return true;
    }
    return false;
  }

  const handleMessage = createWorkflowMessageHandler(set, get);

  return {
    // Initial state
    ws: null,
    featureId: null,
    projectId: null,
    queue: [],
    activeAgents: new Map(),
    planAgent: null,
    prdAgent: null,
    workflowStatus: "idle",
    pauseReason: null,
    autonomyLevel: 1,
    selectedItemId: null,
    error: null,
    hydrated: false,
    startingBuild: false,
    continuingBuild: false,
    startingSession: false,
    slashCommands: [],
    slashCommandsLoading: false,
    worktreeStatus: "idle",
    worktreePath: null,
    worktreeBranch: null,
    worktreeSetupOutput: [],
    worktreeError: null,
    featureTitle: null,
    workflowDefinitionId: null,
    phaseStates: new Map(),
    pendingApproval: null,

    requestSlashCommands(cwd: string) {
      const { ws, slashCommands, slashCommandsLoading } = get();
      if (slashCommands.length > 0 || slashCommandsLoading) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      set({ slashCommandsLoading: true });
      ws.send(JSON.stringify(createCommandsGet(cwd)));
    },

    connect(featureId, projectId) {
      const prev = get().ws;
      if (prev) prev.close();

      const ws = new WebSocket(getWsUrl());
      set({
        ws, featureId, projectId,
        queue: [], activeAgents: new Map(), planAgent: null, prdAgent: null,
        workflowStatus: "idle", pauseReason: null, selectedItemId: null, error: null, hydrated: false, startingBuild: false, continuingBuild: false,
        worktreeStatus: "idle" as const, worktreePath: null, worktreeSetupOutput: [], worktreeError: null,
        featureTitle: null, slashCommands: [], slashCommandsLoading: false,
        workflowDefinitionId: null, phaseStates: new Map(), pendingApproval: null,
      });

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({
          id: crypto.randomUUID(),
          domain: "workflow",
          action: "feature.start",
          payload: { feature_id: featureId, project_id: projectId },
        }));
      });
      ws.addEventListener("message", handleMessage);
      ws.addEventListener("close", () => {
        if (get().ws === ws) set({ ws: null });
      });
    },

    disconnect() {
      const { ws } = get();
      if (ws) ws.close();
      set({ ws: null });
    },

    hydrateFromSnapshot(snapshot) {
      const state = get();
      if (state.hydrated) return;
      set(hydrateFromSnapshotPatch(state, snapshot));
    },

    selectItem(itemId) {
      set({ selectedItemId: itemId });
    },

    clearError() {
      set({ error: null });
    },

    approvePhase(phaseSlug, approved, feedback) {
      const { ws, featureId } = get();
      if (!ws || ws.readyState !== WebSocket.OPEN || !featureId) return;
      ws.send(JSON.stringify(createPhaseApproval(featureId, phaseSlug, approved, feedback)));
    },

    triggerPhase(phaseSlug) {
      const { ws, featureId } = get();
      if (!ws || ws.readyState !== WebSocket.OPEN || !featureId) return;
      ws.send(JSON.stringify(createPhaseTrigger(featureId, phaseSlug)));
    },

    startCustomWorkflow(featureId, projectId, title, workflowDefinitionId, description, useWorktree) {
      const { ws } = get();
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(createCustomWorkflowStart(featureId, projectId, title, workflowDefinitionId, description, useWorktree)));
      set({ workflowDefinitionId });
    },

    setAutonomyLevel(level) {
      set({ autonomyLevel: level });
      send("set_autonomy", { level });
    },

    setParallelExecution(enabled: boolean) {
      send("set_parallel", { enabled });
    },

    startPlan(description, images) {
      send("start_plan", { description, images });
    },

    startPrd(description, images) {
      send("start_prd", { description, images });
    },

    approvePlan(requestId) {
      const isPrd = get().workflowStatus === "prd";
      send(isPrd ? "prd.approved" : "plan.approved", { approved: true, request_id: requestId });
      set(state => {
        const agentKey = isPrd ? "prdAgent" : "planAgent";
        const agent = state[agentKey];
        if (!agent) return {};
        const label = isPrd ? "PRD" : "Plan";
        const block = {
          id: `ws-user-${Date.now()}`,
          type: "user_message" as const,
          content: `✅ ${label} approved`,
          isError: false,
          createdAt: new Date().toISOString(),
        };
        return { [agentKey]: { ...agent, blocks: [...agent.blocks, block] } };
      });
    },

    rejectPlan(feedback, requestId) {
      const isPrd = get().workflowStatus === "prd";
      send(isPrd ? "prd.rejected" : "plan.rejected", { approved: false, feedback, request_id: requestId });
      set(state => {
        const agentKey = isPrd ? "prdAgent" : "planAgent";
        const agent = state[agentKey];
        if (!agent) return {};
        if (!feedback) return {};
        const label = isPrd ? "PRD" : "Plan";
        const block = {
          id: `ws-user-${Date.now()}`,
          type: "user_message" as const,
          content: `**${label} feedback:**\n${feedback}`,
          isError: false,
          createdAt: new Date().toISOString(),
        };
        return { [agentKey]: { ...agent, blocks: [...agent.blocks, block] } };
      });
    },

    startBuild() {
      set({ startingBuild: true });
      send("start_build", {});
    },

    continueWorkflow() {
      set({ continuingBuild: true });
      send("continue", {});
    },

    skipItem(itemId) {
      send("skip_item", { item_id: itemId });
    },

    retryItem(itemId) {
      send("retry_item", { item_id: itemId });
    },

    retryWorktreeSetup() {
      set({ worktreeStatus: "setup_running", worktreeError: null, worktreeSetupOutput: [] });
      send("retry_worktree_setup");
    },

    respondToPermission(itemId, requestId, decision) {
      send("permission.respond", { agent_slot: itemIdToSlot(get(), itemId), request_id: requestId, decision });
      set(state => patchAgentByItemId(state, itemId, { pendingPermission: null }));
    },

    respondToQuestion(itemId, response) {
      const state = get();
      let agent: AgentSessionState | null = null;
      if (itemId === PLAN_KEY) agent = state.planAgent;
      else if (itemId === PRD_KEY) agent = state.prdAgent;
      else agent = state.activeAgents.get(itemId) ?? null;

      if (!agent) return;

      const updatedInput = { ...agent.pendingQuestionToolInput, answers: { "0": response } };
      send("permission.respond", {
        agent_slot: itemIdToSlot(get(), itemId),
        request_id: agent.pendingQuestionRequestId,
        decision: "allow_once",
        updated_input: updatedInput,
      });

      const clearPatch = computeRespondToQuestionClearPatch();
      set(state => {
        if (itemId === PLAN_KEY && state.planAgent) {
          return { planAgent: { ...state.planAgent, ...clearPatch } };
        }
        if (itemId === PRD_KEY && state.prdAgent) {
          return { prdAgent: { ...state.prdAgent, ...clearPatch } };
        }
        const activeAgents = new Map(state.activeAgents);
        const a = activeAgents.get(itemId);
        if (a) activeAgents.set(itemId, { ...a, ...clearPatch });
        return { activeAgents };
      });
    },

    sendPromptToAgent(itemId, text, images) {
      set(state => computeSendPromptPatch(state, itemId, text, images));
      send("prompt.send", { agent_slot: itemIdToSlot(get(), itemId), text, images });
    },

    interruptItem(itemId) {
      set(state => {
        const agentPatch = patchAgentByItemId(state, itemId, { status: "paused" });
        if (itemId > 0) {
          const queue = state.queue.map(q =>
            q.id === itemId && q.status === "running" ? { ...q, status: "paused" as const } : q,
          );
          return { ...agentPatch, queue };
        }
        return agentPatch;
      });
      send("interrupt", { agent_slot: itemIdToSlot(get(), itemId) });
    },

    resumeItem(itemId) {
      set(state => {
        const agentPatch = patchAgentByItemId(state, itemId, { status: "running" });
        if (itemId > 0) {
          const queue = state.queue.map(q =>
            q.id === itemId && q.status === "paused" ? { ...q, status: "running" as const } : q,
          );
          return { ...agentPatch, queue };
        }
        return agentPatch;
      });
      send("prompt.send", { agent_slot: itemIdToSlot(get(), itemId), text: "", images: null });
    },

    startSession(prompt, images) {
      set({ startingSession: true });
      if (!send("start_session", { prompt, images })) {
        set({ startingSession: false, error: "Not connected — cannot start session" });
      }
    },

    startRefine(description, images) {
      send("start_refine", { description, images });
    },

    startReviewFixer(comments) {
      send("start_review_fixer", { comments });
    },

    startRisk() {
      send("start_risk", {});
    },

    startRetro() {
      send("start_retro", {});
    },

    markDone(itemId) {
      send("mark_done", { agent_slot: itemIdToSlot(get(), itemId) });
    },

    removeAgent(itemId) {
      set(state => {
        const activeAgents = new Map(state.activeAgents);
        activeAgents.delete(itemId);
        return { activeAgents };
      });
    },

    deleteSession(sessionDbId: number) {
      const { ws } = get();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          id: crypto.randomUUID(),
          domain: "session",
          action: "delete",
          payload: { session_id: String(sessionDbId) },
        }));
      }
      set(state => {
        if (state.planAgent?.sessionId === sessionDbId) return { planAgent: null };
        if (state.prdAgent?.sessionId === sessionDbId) return { prdAgent: null };
        const activeAgents = new Map(state.activeAgents);
        for (const [itemId, agent] of activeAgents) {
          if (agent.sessionId === sessionDbId) {
            activeAgents.delete(itemId);
            return { activeAgents };
          }
        }
        return {};
      });
    },

    populateAgentBlocks(itemId, blocks, hasMore, oldestMessageId) {
      set(state => {
        const agent = resolveAgentByItemId(state, itemId);
        if (!agent) return state;
        if (agent.historyLoaded || agent.blocks.length > 0) {
          // Blocks already present (e.g. from WS streaming) — still update
          // pagination metadata so load-older works.
          const nextHasMore = hasMore ?? agent.hasMore ?? false;
          const nextOldest = oldestMessageId ?? agent.oldestMessageId ?? null;
          if (agent.historyLoaded && nextHasMore === agent.hasMore && nextOldest === agent.oldestMessageId) {
            return state;
          }
          return patchAgentByItemId(state, itemId, {
            historyLoaded: true,
            hasMore: nextHasMore,
            oldestMessageId: nextOldest,
          });
        }
        const fileChanges = agent.hasFileChanges || blocksContainFileChange(blocks);
        return patchAgentByItemId(state, itemId, { blocks, historyLoaded: true, hasFileChanges: fileChanges, hasMore: hasMore ?? false, oldestMessageId: oldestMessageId ?? null });
      });
    },

    populateOlderBlocks(itemId, olderBlocks, hasMore, oldestMessageId) {
      set(state => {
        const agent = resolveAgentByItemId(state, itemId);
        if (!agent) return state;
        return patchAgentByItemId(state, itemId, {
          blocks: [...olderBlocks, ...agent.blocks],
          hasMore,
          oldestMessageId,
        });
      });
    },
  };
});
