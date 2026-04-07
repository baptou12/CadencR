/** Zustand store for workflow-specific WebSocket state. Agents in a single Map<string, AgentSessionState>. */

import { create } from "zustand";
import { getWsUrl } from "@/lib/ws-url";
import { createCommandsGet, createPhaseApproval, createPhaseTrigger, createCustomWorkflowStart } from "@/lib/ws-envelope";
import { createWorkflowMessageHandler } from "@/hooks/workflow-event-handlers";
import {
  hydrateFromSnapshotPatch,
  computeSendPromptPatch,
  computeRespondToQuestionClearPatch,
} from "@/hooks/workflow-store-helpers";
import {
  type WorkflowState,
  slotKeyToAgentSlot,
  PLAN_KEY,
  PRD_KEY,
} from "@/types/workflow";

import { patchAgent, blocksContainFileChange } from "@/hooks/agent-event-handlers";

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
    agents: new Map(),
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
        queue: [], agents: new Map(),
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

    hydrateFromSnapshot(snapshot, agentState) {
      const state = get();
      if (state.hydrated) return;
      set(hydrateFromSnapshotPatch(state, snapshot, agentState));
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
        const agentKey = isPrd ? PRD_KEY : PLAN_KEY;
        const agent = state.agents.get(agentKey);
        if (!agent) return {};
        const label = isPrd ? "PRD" : "Plan";
        const block = {
          id: `ws-user-${Date.now()}`,
          type: "user_message" as const,
          content: `✅ ${label} approved`,
          isError: false,
          createdAt: new Date().toISOString(),
        };
        const agents = new Map(state.agents);
        agents.set(agentKey, { ...agent, blocks: [...agent.blocks, block] });
        return { agents };
      });
    },

    rejectPlan(feedback, requestId) {
      const isPrd = get().workflowStatus === "prd";
      send(isPrd ? "prd.rejected" : "plan.rejected", { approved: false, feedback, request_id: requestId });
      set(state => {
        const agentKey = isPrd ? PRD_KEY : PLAN_KEY;
        const agent = state.agents.get(agentKey);
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
        const agents = new Map(state.agents);
        agents.set(agentKey, { ...agent, blocks: [...agent.blocks, block] });
        return { agents };
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

    respondToPermission(slotKey, requestId, decision) {
      send("permission.respond", { agent_slot: slotKeyToAgentSlot(slotKey), request_id: requestId, decision });
      set(state => patchAgent(state, slotKey, { pendingPermission: null }));
    },

    respondToQuestion(slotKey, response) {
      const state = get();
      const agent = state.agents.get(slotKey);
      if (!agent) return;

      const updatedInput = { ...agent.pendingQuestionToolInput, answers: { "0": response } };
      send("permission.respond", {
        agent_slot: slotKeyToAgentSlot(slotKey),
        request_id: agent.pendingQuestionRequestId,
        decision: "allow_once",
        updated_input: updatedInput,
      });

      const clearPatch = computeRespondToQuestionClearPatch();
      set(state => {
        const a = state.agents.get(slotKey);
        if (!a) return {};
        const agents = new Map(state.agents);
        agents.set(slotKey, { ...a, ...clearPatch });
        return { agents };
      });
    },

    sendPromptToAgent(slotKey, text, images) {
      set(state => computeSendPromptPatch(state, slotKey, text, images));
      send("prompt.send", { agent_slot: slotKeyToAgentSlot(slotKey), text, images });
    },

    interruptItem(slotKey) {
      set(state => {
        const agentPatch = patchAgent(state, slotKey, { status: "paused" });
        if (slotKey.startsWith("qi:")) {
          const queueItemId = parseInt(slotKey.slice(3), 10);
          const queue = state.queue.map(q =>
            q.id === queueItemId && q.status === "running" ? { ...q, status: "paused" as const } : q,
          );
          return { ...agentPatch, queue };
        }
        return agentPatch;
      });
      send("interrupt", { agent_slot: slotKeyToAgentSlot(slotKey) });
    },

    resumeItem(slotKey) {
      set(state => {
        const agentPatch = patchAgent(state, slotKey, { status: "running" });
        if (slotKey.startsWith("qi:")) {
          const queueItemId = parseInt(slotKey.slice(3), 10);
          const queue = state.queue.map(q =>
            q.id === queueItemId && q.status === "paused" ? { ...q, status: "running" as const } : q,
          );
          return { ...agentPatch, queue };
        }
        return agentPatch;
      });
      send("prompt.send", { agent_slot: slotKeyToAgentSlot(slotKey), text: "", images: null });
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

    markDone(slotKey) {
      send("mark_done", { agent_slot: slotKeyToAgentSlot(slotKey) });
    },

    removeAgent(slotKey) {
      set(state => {
        const agents = new Map(state.agents);
        agents.delete(slotKey);
        return { agents };
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
        const agents = new Map(state.agents);
        for (const [key, agent] of agents) {
          if (agent.sessionId === sessionDbId) {
            agents.delete(key);
            return { agents };
          }
        }
        return {};
      });
    },

    populateAgentBlocks(slotKey, blocks, hasMore, oldestMessageId) {
      set(state => {
        const agent = state.agents.get(slotKey);
        if (!agent) return state;
        if (agent.historyLoaded || agent.blocks.length > 0) {
          const nextHasMore = hasMore ?? agent.hasMore ?? false;
          const nextOldest = oldestMessageId ?? agent.oldestMessageId ?? null;
          if (agent.historyLoaded && nextHasMore === agent.hasMore && nextOldest === agent.oldestMessageId) {
            return state;
          }
          return patchAgent(state, slotKey, {
            historyLoaded: true,
            hasMore: nextHasMore,
            oldestMessageId: nextOldest,
          });
        }
        const fileChanges = agent.hasFileChanges || blocksContainFileChange(blocks);
        return patchAgent(state, slotKey, { blocks, historyLoaded: true, hasFileChanges: fileChanges, hasMore: hasMore ?? false, oldestMessageId: oldestMessageId ?? null });
      });
    },

    populateOlderBlocks(slotKey, olderBlocks, hasMore, oldestMessageId) {
      set(state => {
        const agent = state.agents.get(slotKey);
        if (!agent) return state;
        return patchAgent(state, slotKey, {
          blocks: [...olderBlocks, ...agent.blocks],
          hasMore,
          oldestMessageId,
        });
      });
    },
  };
});
