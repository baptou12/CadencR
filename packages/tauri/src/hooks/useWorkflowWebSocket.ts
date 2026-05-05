/** Zustand store for workflow-specific WebSocket state. Agents in a single Map<string, AgentSessionState>. */

import { create } from "zustand";
import { getWsProtocols, getWsUrl } from "@/lib/ws-url";
import { createWsConnection } from "@/lib/ws-connection";
import { createCommandsGet } from "@/lib/ws-envelope";
import { createWorkflowMessageHandler } from "@/hooks/workflow-event-handlers";
import { hydrateFromSnapshotPatch } from "@/hooks/workflow-store-helpers";
import { type WorkflowState, slotKeyToAgentSlot } from "@/types/workflow";
import { buildSlashCommandsKey } from "@/lib/slash-command-key";

import { blocksContainFileChange, patchAgent } from "@/hooks/agent-event-handlers";
import type { AgentQuestionAnswers } from "@/components/AgentQuestionDrawer";
import { buildAskUserQuestionUpdatedInput } from "@/lib/build-ask-user-question-payload";

export const useWorkflowStore = create<WorkflowState>((set, get) => {
  function send(action: string, payload: Record<string, unknown> = {}): boolean {
    const { conn, featureId } = get();
    if (!conn) return false;
    return conn.sendJson({
      id: crypto.randomUUID(),
      domain: "workflow",
      action,
      payload: { feature_id: featureId, ...payload },
    });
  }

  const handleMessage = createWorkflowMessageHandler(set, get);

  return {
    // Initial state
    conn: null,
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
    slashCommandsKey: null,
    slashCommandsRequestRef: null,
    worktreeStatus: "idle",
    worktreePath: null,
    worktreeBranch: null,
    worktreeSetupOutput: [],
    worktreeError: null,
    featureTitle: null,
    isAutoNaming: false,
    bufferedEvents: [],
    isReconnecting: false,

    requestSlashCommands(cwd: string, provider: string) {
      const { conn, slashCommands, slashCommandsLoading, slashCommandsKey } = get();
      const nextKey = buildSlashCommandsKey(cwd, provider);
      const sameTarget = slashCommandsKey === nextKey;
      if (sameTarget && slashCommandsLoading) return;
      if (!conn?.isOpen()) return;
      const envelope = createCommandsGet(cwd, provider);
      set({
        slashCommands: sameTarget ? slashCommands : [],
        slashCommandsLoading: true,
        slashCommandsKey: nextKey,
        slashCommandsRequestRef: envelope.id,
      });
      conn.sendJson(envelope);
    },

    connect(featureId, projectId) {
      const prev = get();
      // No-op when already connected to the same feature. Makes `connect()`
      // idempotent so React StrictMode's double-invoke (and any redundant
      // calls from parent hooks) doesn't churn WS opens/closes.
      const alreadyConnected =
        prev.featureId === featureId &&
        prev.projectId === projectId &&
        prev.conn?.isOpen() === true;
      if (alreadyConnected) return;

      // Soft reconnect: same feature/project reopened after a WS drop.
      // Re-hydrate from REST so we pick up any events that streamed (and were
      // persisted to the DB) while we were disconnected — otherwise missed
      // tokens stay missing. The only observable difference from a hard reset
      // is the `isReconnecting` flag, which drives a thin refresh stripe.
      const isSoftReconnect =
        prev.featureId === featureId && prev.projectId === projectId && prev.hydrated;

      prev.conn?.close();

      const conn = createWsConnection({
        url: getWsUrl(),
        protocols: getWsProtocols(),
        onOpen: () => {
          conn.sendJson({
            id: crypto.randomUUID(),
            domain: "workflow",
            action: "feature.start",
            payload: { feature_id: featureId, project_id: projectId },
          });
        },
        onMessage: (data) => {
          const evt = { data } as MessageEvent;
          // Until REST snapshot hydration completes, buffer all WS events.
          // Otherwise they race with `hydrateFromSnapshot` and streamed blocks
          // get overwritten by the snapshot merge.
          if (!get().hydrated) {
            set((state) => ({ bufferedEvents: [...state.bufferedEvents, evt] }));
            return;
          }
          handleMessage(evt);
        },
        onClose: () => {
          if (get().conn === conn) set({ conn: null });
        },
      });

      set({
        conn,
        featureId,
        projectId,
        queue: [],
        agents: new Map(),
        workflowStatus: "idle",
        pauseReason: null,
        selectedItemId: null,
        error: null,
        hydrated: false,
        startingBuild: false,
        continuingBuild: false,
        worktreeStatus: "idle" as const,
        worktreePath: null,
        worktreeSetupOutput: [],
        worktreeError: null,
        featureTitle: null,
        isAutoNaming: false,
        slashCommands: [],
        slashCommandsLoading: false,
        slashCommandsKey: null,
        slashCommandsRequestRef: null,
        bufferedEvents: [],
        isReconnecting: isSoftReconnect,
      });
    },

    disconnect() {
      get().conn?.close();
      set({ conn: null });
    },

    hydrateFromSnapshot(snapshot, agentState) {
      const state = get();
      if (state.hydrated) return;
      set(hydrateFromSnapshotPatch(state, snapshot, agentState));
      // Drain any WS events that arrived while REST was loading. Must happen
      // after snapshot merge so live stream events land on top of the
      // authoritative history rather than being clobbered by it.
      const buffered = get().bufferedEvents;
      if (buffered.length > 0) {
        set({ bufferedEvents: [] });
        for (const evt of buffered) handleMessage(evt);
      }
    },

    selectItem(itemId) {
      set({ selectedItemId: itemId });
    },

    clearError() {
      set({ error: null });
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
      // Backend emits `agent_user_message` (persist_approval_message) and
      // `status_changed`, which together append the block and clear
      // `pendingPlanApproval`. No optimistic write here.
    },

    rejectPlan(feedback, requestId) {
      const isPrd = get().workflowStatus === "prd";
      send(isPrd ? "prd.rejected" : "plan.rejected", {
        approved: false,
        feedback,
        request_id: requestId,
      });
      // Backend handles the feedback block + pending clear; see approvePlan.
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

    respondToPermission(slotKey, requestId, decision, feedback, optionId) {
      send("permission.respond", {
        agent_slot: slotKeyToAgentSlot(slotKey),
        request_id: requestId,
        decision,
        ...(feedback ? { feedback } : {}),
        ...(optionId ? { option_id: optionId } : {}),
      });
      // Backend emits `pending_cleared` on success; no optimistic clear.
    },

    respondToQuestion(slotKey: string, response: AgentQuestionAnswers) {
      const state = get();
      const agent = state.agents.get(slotKey);
      if (!agent) return;

      const updatedInput = buildAskUserQuestionUpdatedInput(
        agent.pendingQuestionToolInput,
        response,
      );
      send("permission.respond", {
        agent_slot: slotKeyToAgentSlot(slotKey),
        request_id: agent.pendingQuestionRequestId,
        decision: "allow_once",
        updated_input: updatedInput,
      });
      // Backend emits `agent_user_message` (persist_qa_answer) + `pending_cleared`;
      // those clear pending-* state for us.
    },

    sendPromptToAgent(slotKey, text, images) {
      send("prompt.send", { agent_slot: slotKeyToAgentSlot(slotKey), text, images });
      // Backend emits `agent_user_message` (persist_user_message), which
      // appends the block and clears pending-*.
    },

    interruptItem(slotKey) {
      send("interrupt", { agent_slot: slotKeyToAgentSlot(slotKey) });
      // Backend emits `interrupted` ack + eventual `agent_paused`; both flip
      // status to "paused" on the frontend.
    },

    resumeItem(slotKey) {
      send("prompt.send", { agent_slot: slotKeyToAgentSlot(slotKey), text: "", images: null });
      // Backend emits `agent_running` + `item_update` on successful resume.
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
      set((state) => {
        const agents = new Map(state.agents);
        agents.delete(slotKey);
        return { agents };
      });
    },

    deleteSession(sessionDbId: number) {
      const { conn } = get();
      conn?.sendJson({
        id: crypto.randomUUID(),
        domain: "session",
        action: "delete",
        payload: { session_id: String(sessionDbId) },
      });
      set((state) => {
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
      set((state) => {
        const agent = state.agents.get(slotKey);
        if (!agent) return state;
        if (agent.historyLoaded || agent.blocks.length > 0) {
          const nextHasMore = hasMore ?? agent.hasMore ?? false;
          const nextOldest = oldestMessageId ?? agent.oldestMessageId ?? null;
          if (
            agent.historyLoaded &&
            nextHasMore === agent.hasMore &&
            nextOldest === agent.oldestMessageId
          ) {
            return state;
          }
          return patchAgent(state, slotKey, {
            historyLoaded: true,
            hasMore: nextHasMore,
            oldestMessageId: nextOldest,
          });
        }
        const fileChanges = agent.hasFileChanges || blocksContainFileChange(blocks);
        return patchAgent(state, slotKey, {
          blocks,
          historyLoaded: true,
          hasFileChanges: fileChanges,
          hasMore: hasMore ?? false,
          oldestMessageId: oldestMessageId ?? null,
        });
      });
    },

    populateOlderBlocks(slotKey, olderBlocks, hasMore, oldestMessageId) {
      set((state) => {
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
