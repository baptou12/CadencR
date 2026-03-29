/**
 * Zustand store for workflow-specific WebSocket state.
 *
 * Manages the queue, active agent sessions, and workflow lifecycle.
 * Reuses processSdkMessage / applyMutations from ws-session-store for
 * all SDK message parsing — no duplication.
 */

import { create } from "zustand";
import { buildUserMessageContent } from "@/types/agent-types";
import { getWsUrl } from "@/lib/ws-url";
import { type AgentQuestion } from "@/components/AgentQuestionDrawer";
import {
  createStreamingState,
} from "@/stores/ws-session-store";
import { createCommandsGet } from "@/lib/ws-envelope";
import {
  createWorkflowMessageHandler,
  createAgentSession,
  sessionDbKey,
  itemIdToSlot,
  MULTI_INSTANCE_TYPES,
  resolveAgentByItemId,
  patchAgentByItemId,
  blocksContainFileChange,
} from "@/hooks/workflow-event-handlers";
export { resolveAgentByItemId } from "@/hooks/workflow-event-handlers";
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
};
export {
  agentSlotKey,
  agentSlotToLegacyId,
  AGENT_TYPE_SYNTHETIC_KEYS,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute a unique activeAgents map key from a DB session ID. */
function sessionDbKey(sessionId: number): number {
  return -1000 - sessionId;
}

const AGENT_TYPE_TO_SLOT: Record<string, AgentSlot["type"]> = {
  session: "session",
  risk: "risk",
  retro: "retro",
  "review-fixer": "review-fixer",
};

/** Converts a dynamic activeAgents key (≤ -1000) back to an AgentSlot by looking up the stored agent type. */
function itemIdToSlot(
  state: Pick<WorkflowState, "activeAgents" | "planAgent" | "prdAgent">,
  itemId: number,
): AgentSlot {
  if (itemId <= -1000) {
    const agent = state.activeAgents.get(itemId);
    const slotType = agent && AGENT_TYPE_TO_SLOT[agent.agentType];
    if (slotType) {
      return { type: slotType, id: agent.sessionId } as AgentSlot;
    }
  }
  return legacyIdToSlot(itemId);
}

/** Agent types that can have multiple concurrent instances (not singleton slots). */
const MULTI_INSTANCE_TYPES = new Set(["session", "risk", "retro", "review-fixer"]);

/** Find the activeAgents map key for a multi-instance slot, preferring running/paused agents. */
function resolveActiveKey(
  state: Pick<WorkflowState, "activeAgents">,
  slot: AgentSlot,
): number | null {
  if (slot.type === "queue_item") return slot.id;
  if (!MULTI_INSTANCE_TYPES.has(slot.type)) {
    return AGENT_TYPE_SYNTHETIC_KEYS[slot.type] ?? null;
  }
  let fallback: number | null = null;
  for (const [key, agent] of state.activeAgents) {
    if (agent.agentType === slot.type) {
      if (agent.status === "running" || agent.status === "paused" || agent.status === "waiting") return key;
      if (fallback === null) fallback = key;
    }
  }
  return fallback;
}

/** Resolve the map key for a multi-instance slot when session_id is available (e.g. agent_paused, agent_running). */
function resolveMultiInstanceKey(slot: AgentSlot, sessionId: number): number {
  return MULTI_INSTANCE_TYPES.has(slot.type)
    ? sessionDbKey(sessionId)
    : agentSlotToLegacyId(slot);
}

const FILE_CHANGE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

function blocksContainFileChange(blocks: AgentBlockData[]): boolean {
  for (const b of blocks) {
    if (b.type === "tool_call" && b.toolName && FILE_CHANGE_TOOLS.has(b.toolName)) return true;
    if (b.childBlocks && blocksContainFileChange(b.childBlocks)) return true;
  }
  return false;
}

function processAgentStream(
  agent: AgentSessionState,
  msg: Record<string, unknown>,
): AgentSessionState {
  const mutations = processSdkMessage(msg, agent.streamingState);
  if (mutations.length === 0) return agent;
  const blocks = applyMutations(agent.blocks, mutations, agent.streamingState);
  const hasNewFileChange = !agent.hasFileChanges && mutations.some(
    (m) => m.action === "append" && m.block.type === "tool_call" && m.block.toolName && FILE_CHANGE_TOOLS.has(m.block.toolName),
  );
  return { ...agent, blocks, ...(hasNewFileChange ? { hasFileChanges: true } : {}) };
}

/**
 * Resolve an agent from the correct state slot based on its item ID.
 * Plan/prd agents live in dedicated slots; everything else in activeAgents.
 */
export function resolveAgentByItemId(
  state: Pick<WorkflowState, "planAgent" | "prdAgent" | "activeAgents">,
  itemId: number,
): AgentSessionState | null {
  if (itemId === PLAN_KEY) return state.planAgent;
  if (itemId === PRD_KEY) return state.prdAgent;
  return state.activeAgents.get(itemId) ?? null;
}

/** Resolve the activeAgents map key for an incoming WS event's slot. */
function resolveItemId(
  state: Pick<WorkflowState, "activeAgents">,
  slot: AgentSlot,
): number {
  if (slot.type === "queue_item") return slot.id;
  if (MULTI_INSTANCE_TYPES.has(slot.type) && "id" in slot && slot.id != null) {
    return sessionDbKey(slot.id);
  }
  if (MULTI_INSTANCE_TYPES.has(slot.type)) {
    return resolveActiveKey(state, slot) ?? agentSlotToLegacyId(slot);
  }
  return agentSlotToLegacyId(slot);
}

/**
 * Route a partial update to the correct agent (planAgent, prdAgent, or activeAgents)
 * based on the synthetic item ID. Returns a Zustand state patch.
 */
function patchAgentByItemId(
  state: WorkflowState,
  itemId: number,
  patch: Partial<AgentSessionState>,
): Partial<WorkflowState> {
  if (itemId === PLAN_KEY && state.planAgent) {
    return { planAgent: { ...state.planAgent, ...patch } };
  }
  if (itemId === PRD_KEY && state.prdAgent) {
    return { prdAgent: { ...state.prdAgent, ...patch } };
  }
  const agent = state.activeAgents.get(itemId);
  if (!agent) return {};
  const activeAgents = new Map(state.activeAgents);
  activeAgents.set(itemId, { ...agent, ...patch });
  return { activeAgents };
}

/** Like patchAgentByItemId but creates the agent if it doesn't exist. */
function upsertAgentByItemId(
  state: WorkflowState,
  itemId: number,
  sessionId: number,
  patch: Partial<AgentSessionState>,
): Partial<WorkflowState> {
  if (itemId === PLAN_KEY) {
    const existing = state.planAgent ?? createAgentSession(sessionId);
    return { planAgent: { ...existing, ...patch } };
  }
  if (itemId === PRD_KEY) {
    const existing = state.prdAgent ?? createAgentSession(sessionId);
    return { prdAgent: { ...existing, ...patch } };
  }
  const activeAgents = new Map(state.activeAgents);
  const existing = activeAgents.get(itemId) ?? createAgentSession(sessionId);
  activeAgents.set(itemId, { ...existing, ...patch });
  return { activeAgents };
||||||| parent of 470e799 (refactor: extract WS event handlers from useWorkflowWebSocket)
function getWsUrl(): string {
  const httpUrl = import.meta.env.VITE_API_URL || "http://localhost:5005";
  return httpUrl.replace(/^http/, "ws") + "/ws";
}

function createAgentSession(sessionId: number, agentType = "execute"): AgentSessionState {
  return {
    sessionId,
    agentType,
    blocks: [],
    streamingState: createStreamingState(),
    status: "running",
    pendingPermission: null,
    pendingQuestions: [],
    pendingQuestionToolInput: {},
    pendingQuestionRequestId: "",
    historyLoaded: false,
    claudeSessionId: null,
    inputTokens: 0,
    outputTokens: 0,
    contextWindow: 200_000,
    hasFileChanges: false,
  };
}

/** Compute a unique activeAgents map key from a DB session ID. */
function sessionDbKey(sessionId: number): number {
  return -1000 - sessionId;
}

const AGENT_TYPE_TO_SLOT: Record<string, AgentSlot["type"]> = {
  session: "session",
  risk: "risk",
  retro: "retro",
  "review-fixer": "review-fixer",
};

/** Converts a dynamic activeAgents key (≤ -1000) back to an AgentSlot by looking up the stored agent type. */
function itemIdToSlot(
  state: Pick<WorkflowState, "activeAgents" | "planAgent" | "prdAgent">,
  itemId: number,
): AgentSlot {
  if (itemId <= -1000) {
    const agent = state.activeAgents.get(itemId);
    const slotType = agent && AGENT_TYPE_TO_SLOT[agent.agentType];
    if (slotType) {
      return { type: slotType, id: agent.sessionId } as AgentSlot;
    }
  }
  return legacyIdToSlot(itemId);
}

/** Agent types that can have multiple concurrent instances (not singleton slots). */
const MULTI_INSTANCE_TYPES = new Set(["session", "risk", "retro", "review-fixer"]);

/** Find the activeAgents map key for a multi-instance slot, preferring running/paused agents. */
function resolveActiveKey(
  state: Pick<WorkflowState, "activeAgents">,
  slot: AgentSlot,
): number | null {
  if (slot.type === "queue_item") return slot.id;
  if (!MULTI_INSTANCE_TYPES.has(slot.type)) {
    return AGENT_TYPE_SYNTHETIC_KEYS[slot.type] ?? null;
  }
  let fallback: number | null = null;
  for (const [key, agent] of state.activeAgents) {
    if (agent.agentType === slot.type) {
      if (agent.status === "running" || agent.status === "paused" || agent.status === "waiting") return key;
      if (fallback === null) fallback = key;
    }
  }
  return fallback;
}

/** Resolve the map key for a multi-instance slot when session_id is available (e.g. agent_paused, agent_running). */
function resolveMultiInstanceKey(slot: AgentSlot, sessionId: number): number {
  return MULTI_INSTANCE_TYPES.has(slot.type)
    ? sessionDbKey(sessionId)
    : agentSlotToLegacyId(slot);
}

const FILE_CHANGE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

function blocksContainFileChange(blocks: AgentBlockData[]): boolean {
  for (const b of blocks) {
    if (b.type === "tool_call" && b.toolName && FILE_CHANGE_TOOLS.has(b.toolName)) return true;
    if (b.childBlocks && blocksContainFileChange(b.childBlocks)) return true;
  }
  return false;
}

function processAgentStream(
  agent: AgentSessionState,
  msg: Record<string, unknown>,
): AgentSessionState {
  const mutations = processSdkMessage(msg, agent.streamingState);
  if (mutations.length === 0) return agent;
  const blocks = applyMutations(agent.blocks, mutations, agent.streamingState);
  const hasNewFileChange = !agent.hasFileChanges && mutations.some(
    (m) => m.action === "append" && m.block.type === "tool_call" && m.block.toolName && FILE_CHANGE_TOOLS.has(m.block.toolName),
  );
  return { ...agent, blocks, ...(hasNewFileChange ? { hasFileChanges: true } : {}) };
}

/**
 * Resolve an agent from the correct state slot based on its item ID.
 * Plan/prd agents live in dedicated slots; everything else in activeAgents.
 */
export function resolveAgentByItemId(
  state: Pick<WorkflowState, "planAgent" | "prdAgent" | "activeAgents">,
  itemId: number,
): AgentSessionState | null {
  if (itemId === PLAN_KEY) return state.planAgent;
  if (itemId === PRD_KEY) return state.prdAgent;
  return state.activeAgents.get(itemId) ?? null;
}

/** Resolve the activeAgents map key for an incoming WS event's slot. */
function resolveItemId(
  state: Pick<WorkflowState, "activeAgents">,
  slot: AgentSlot,
): number {
  if (slot.type === "queue_item") return slot.id;
  if (MULTI_INSTANCE_TYPES.has(slot.type) && "id" in slot && slot.id != null) {
    return sessionDbKey(slot.id);
  }
  if (MULTI_INSTANCE_TYPES.has(slot.type)) {
    return resolveActiveKey(state, slot) ?? agentSlotToLegacyId(slot);
  }
  return agentSlotToLegacyId(slot);
}

/**
 * Route a partial update to the correct agent (planAgent, prdAgent, or activeAgents)
 * based on the synthetic item ID. Returns a Zustand state patch.
 */
function patchAgentByItemId(
  state: WorkflowState,
  itemId: number,
  patch: Partial<AgentSessionState>,
): Partial<WorkflowState> {
  if (itemId === PLAN_KEY && state.planAgent) {
    return { planAgent: { ...state.planAgent, ...patch } };
  }
  if (itemId === PRD_KEY && state.prdAgent) {
    return { prdAgent: { ...state.prdAgent, ...patch } };
  }
  const agent = state.activeAgents.get(itemId);
  if (!agent) return {};
  const activeAgents = new Map(state.activeAgents);
  activeAgents.set(itemId, { ...agent, ...patch });
  return { activeAgents };
}

/** Like patchAgentByItemId but creates the agent if it doesn't exist. */
function upsertAgentByItemId(
  state: WorkflowState,
  itemId: number,
  sessionId: number,
  patch: Partial<AgentSessionState>,
): Partial<WorkflowState> {
  if (itemId === PLAN_KEY) {
    const existing = state.planAgent ?? createAgentSession(sessionId);
    return { planAgent: { ...existing, ...patch } };
  }
  if (itemId === PRD_KEY) {
    const existing = state.prdAgent ?? createAgentSession(sessionId);
    return { prdAgent: { ...existing, ...patch } };
  }
  const activeAgents = new Map(state.activeAgents);
  const existing = activeAgents.get(itemId) ?? createAgentSession(sessionId);
  activeAgents.set(itemId, { ...existing, ...patch });
  return { activeAgents };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWorkflowStore = create<WorkflowState>((set, get) => {
  function send(action: string, payload: Record<string, unknown> = {}) {
    const { ws, featureId } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        id: crypto.randomUUID(),
        domain: "workflow",
        action,
        payload: { feature_id: featureId, ...payload },
      }));
    }
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
        worktreeStatus: "idle" as const, worktreePath: null, worktreeBranch: null, worktreeSetupOutput: [], worktreeError: null,
        featureTitle: null, slashCommands: [], slashCommandsLoading: false,
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

      // WS may have already delivered queue data — keep it when available,
      // but always merge agent sessions from the snapshot so that non-queue
      // agents (session, risk, retro, etc.) aren't lost.
      const hasWsQueue = state.queue.length > 0;

      const activeAgents = new Map(state.activeAgents);
      let planAgent: AgentSessionState | null = state.planAgent;
      let prdAgent: AgentSessionState | null = state.prdAgent;

      for (const session of snapshot.agent_sessions) {
        const agentType = session.agent_type ?? "execute";

        const agentState: AgentSessionState = {
          sessionId: session.id,
          agentType,
          blocks: [],
          streamingState: createStreamingState(),
          status: (session.status as AgentSessionState["status"]) ?? "idle",
          pendingPermission: null,
          pendingQuestions: [],
          pendingQuestionToolInput: {},
          pendingQuestionRequestId: "",
          historyLoaded: false,
          claudeSessionId: session.claude_session_id ?? null,
          inputTokens: session.input_tokens ?? 0,
          outputTokens: session.output_tokens ?? 0,
          contextWindow: session.context_window || 200_000,
          hasFileChanges: false,
        };

        // Plan/prd go into dedicated slots; skip if WS already populated them
        if (agentType === "plan" || agentType === "refine") {
          if (!planAgent) planAgent = agentState;
        } else if (agentType === "prd") {
          if (!prdAgent) prdAgent = agentState;
        } else {
          // Multi-instance types get unique keys; queue items use their queue ID
          const key = session.queue_item_id
            ?? (MULTI_INSTANCE_TYPES.has(agentType) ? sessionDbKey(session.id) : (AGENT_TYPE_SYNTHETIC_KEYS[agentType] ?? sessionDbKey(session.id)));
          if (!activeAgents.has(key)) activeAgents.set(key, agentState);
        }
      }

      const patch: Partial<WorkflowState> = {
        // Prefer WS-delivered queue over snapshot (more up-to-date)
        queue: hasWsQueue ? state.queue : snapshot.queue,
        workflowStatus: hasWsQueue && state.workflowStatus !== "idle"
          ? state.workflowStatus : snapshot.workflow_status,
        autonomyLevel: (snapshot.autonomy_level as AutonomyLevel) ?? 1,
        activeAgents,
        planAgent,
        prdAgent,
        hydrated: true,
      };

      if (snapshot.worktree) {
        patch.worktreePath = snapshot.worktree.path;
        patch.worktreeBranch = snapshot.worktree.branch;
        patch.worktreeStatus = snapshot.worktree.status as WorktreeStatus;
        if (snapshot.worktree.setup_log) {
          patch.worktreeSetupOutput = snapshot.worktree.setup_log.split("\n");
        }
      }

      set(patch);
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
      // Add user message to the appropriate agent conversation
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
      // Add user feedback message to the appropriate agent conversation
      set(state => {
        const agentKey = isPrd ? "prdAgent" : "planAgent";
        const agent = state[agentKey];
        if (!agent) return {};
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
      // Clear pendingPermission so the prompt dismisses immediately
      set(state => patchAgentByItemId(state, itemId, { pendingPermission: null }));
    },

    respondToQuestion(itemId, response) {
      // Find the agent to get the stored tool input and request ID
      const state = get();
      let agent: AgentSessionState | null = null;
      if (itemId === PLAN_KEY) agent = state.planAgent;
      else if (itemId === PRD_KEY) agent = state.prdAgent;
      else agent = state.activeAgents.get(itemId) ?? null;

      if (!agent) return;

      const updatedInput = {
        ...agent.pendingQuestionToolInput,
        answers: { "0": response },
      };
      send("permission.respond", {
        agent_slot: itemIdToSlot(get(), itemId),
        request_id: agent.pendingQuestionRequestId,
        decision: "allow_once",
        updated_input: updatedInput,
      });

      // Clear questions state
      const clearPatch = {
        pendingQuestions: [] as AgentQuestion[],
        pendingQuestionToolInput: {},
        pendingQuestionRequestId: "",
      };
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
      // Optimistically add user message block and set status to running (handles resume from paused)
      set(state => {
        const content = buildUserMessageContent(text, images);
        const userBlock = {
          id: `ws-user-${Date.now()}`,
          type: "user_message" as const,
          content,
          isError: false,
          createdAt: new Date().toISOString(),
        };

        // Resolve current blocks for the target agent
        const currentAgent = itemId === PLAN_KEY ? state.planAgent
          : itemId === PRD_KEY ? state.prdAgent
          : state.activeAgents.get(itemId);
        if (!currentAgent) return {};

        const agentPatch = patchAgentByItemId(state, itemId, {
          status: "running",
          blocks: [...currentAgent.blocks, userBlock],
        });
        if (itemId > 0) {
          const queue = state.queue.map(q =>
            q.id === itemId && q.status === "paused" ? { ...q, status: "running" as const } : q,
          );
          return { ...agentPatch, queue };
        }
        return agentPatch;
      });
      send("prompt.send", { agent_slot: itemIdToSlot(get(), itemId), text, images });
    },

    interruptItem(itemId) {
      // Optimistically update agent status to paused so the UI responds immediately
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
      // Optimistically set agent back to running
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
      // Send empty prompt to trigger resume on the backend
      send("prompt.send", { agent_slot: itemIdToSlot(get(), itemId), text: "", images: null });
    },

    startSession(prompt, images) {
      set({ startingSession: true });
      send("start_session", { prompt, images });
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
      // Remove from local state (activeAgents, planAgent, or prdAgent)
      set(state => {
        if (state.planAgent?.sessionId === sessionDbId) {
          return { planAgent: null };
        }
        if (state.prdAgent?.sessionId === sessionDbId) {
          return { prdAgent: null };
        }
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
        if (!agent || agent.historyLoaded || agent.blocks.length > 0) return state;
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
