/**
 * Agent-related WebSocket event helpers and handlers.
 *
 * Extracted from workflow-event-handlers.ts to keep file sizes under 400 lines.
 * Contains: agent session factory, slot/key helpers, block/stream helpers,
 * agent state routing helpers, and handler functions for agent WS events.
 */

import type { AgentBlockData } from "@/components/AgentBlock";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import { parseAskUserQuestions } from "@/components/AgentQuestionDrawer";
import {
  createStreamingState,
  processSdkMessage,
  applyMutations,
} from "@/stores/ws-session-store";
import {
  type WorkflowState,
  type AgentSessionState,
  type AgentSlot,
  agentSlotKey as _agentSlotKey,
  agentSlotToLegacyId,
  legacyIdToSlot,
  parseAgentSlot,
  AGENT_TYPE_SYNTHETIC_KEYS,
  PLAN_KEY,
  PRD_KEY,
} from "@/types/workflow";

// -- Agent session factory --

export function createAgentSession(sessionId: number, agentType = "execute"): AgentSessionState {
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
// Slot / key helpers
/** Compute a unique activeAgents map key from a DB session ID. */
export function sessionDbKey(sessionId: number): number {
  return -1000 - sessionId;
}

const AGENT_TYPE_TO_SLOT: Record<string, AgentSlot["type"]> = {
  session: "session",
  risk: "risk",
  retro: "retro",
  "review-fixer": "review-fixer",
};

/** Converts a dynamic activeAgents key (≤ -1000) back to an AgentSlot by looking up the stored agent type. */
export function itemIdToSlot(
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
export const MULTI_INSTANCE_TYPES = new Set(["session", "risk", "retro", "review-fixer"]);

/** Find the activeAgents map key for a multi-instance slot, preferring running/paused agents. */
export function resolveActiveKey(
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

/** Resolve the map key for a multi-instance slot when session_id is available. */
export function resolveMultiInstanceKey(slot: AgentSlot, sessionId: number): number {
  return MULTI_INSTANCE_TYPES.has(slot.type)
    ? sessionDbKey(sessionId)
    : agentSlotToLegacyId(slot);
}
// Block / stream helpers
export const FILE_CHANGE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

export function blocksContainFileChange(blocks: AgentBlockData[]): boolean {
  for (const b of blocks) {
    if (b.type === "tool_call" && b.toolName && FILE_CHANGE_TOOLS.has(b.toolName)) return true;
    if (b.childBlocks && blocksContainFileChange(b.childBlocks)) return true;
  }
  return false;
}

export function processAgentStream(
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
// Agent state routing helpers
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
export function resolveItemId(
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
export function patchAgentByItemId(
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
export function upsertAgentByItemId(
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
/** Insert a fresh agent session into activeAgents, preserving any blocks that arrived before the .started event. */
export function insertAgentSession(
  state: Pick<WorkflowState, "activeAgents">,
  sessionId: number,
  agentType: string,
): { activeAgents: Map<number, AgentSessionState> } {
  const activeAgents = new Map(state.activeAgents);
  const key = sessionDbKey(sessionId);
  const existing = activeAgents.get(key);
  activeAgents.set(key, { ...createAgentSession(sessionId, agentType), blocks: existing?.blocks ?? [] });
  return { activeAgents };
}

// SetFn type (shared with workflow-event-handlers.ts)
export type SetFn = (
  partial: Partial<WorkflowState> | ((state: WorkflowState) => Partial<WorkflowState>),
) => void;
// Agent WS event handlers
export function handleAgentStream(
  payload: Record<string, unknown>,
  set: SetFn,
): void {
  const streamSlot = parseAgentSlot(payload);
  const blocks = (payload.blocks ?? []) as Record<string, unknown>[];
  const singleMsg = payload.message as Record<string, unknown> | undefined;
  const msgs = blocks.length > 0 ? blocks : singleMsg ? [singleMsg] : [];
  if (msgs.length === 0) return;

  if (streamSlot.type === "plan" || streamSlot.type === "prd" || streamSlot.type === "refine") {
    const key = (streamSlot.type === "prd" ? "prdAgent" : "planAgent") as "planAgent" | "prdAgent";
    set(state => {
      let agent = state[key] ?? createAgentSession(0, streamSlot.type);
      for (const msg of msgs) {
        agent = processAgentStream(agent, msg);
      }
      return { [key]: agent };
    });
    return;
  }

  set(state => {
    const itemId = resolveItemId(state, streamSlot);
    const agent = state.activeAgents.get(itemId);
    if (!agent) return state;
    let updated = agent;
    for (const msg of msgs) {
      updated = processAgentStream(updated, msg);
    }
    if (updated === agent) return state;
    const activeAgents = new Map(state.activeAgents);
    activeAgents.set(itemId, updated);
    return { activeAgents };
  });
}

export function handleAgentPaused(
  payload: Record<string, unknown>,
  set: SetFn,
): void {
  const pausedSlot = parseAgentSlot(payload);
  const pausedSessionId = payload.session_id as number;
  const pausedClaudeSessionId = (payload.claude_session_id as string) || null;
  set(state => {
    const pausedItemId = resolveMultiInstanceKey(pausedSlot, pausedSessionId);
    return upsertAgentByItemId(state, pausedItemId, pausedSessionId, {
      sessionId: pausedSessionId, status: "paused", claudeSessionId: pausedClaudeSessionId,
      agentType: pausedSlot.type,
    });
  });
}

export function handleAgentRunning(
  payload: Record<string, unknown>,
  set: SetFn,
): void {
  const runSlot = parseAgentSlot(payload);
  const runSessionId = payload.session_id as number;
  set(state => {
    const runItemId = resolveMultiInstanceKey(runSlot, runSessionId);
    const agentPatch = upsertAgentByItemId(state, runItemId, runSessionId, {
      sessionId: runSessionId, status: "running", agentType: runSlot.type,
    });
    const queue = state.queue.map(q =>
      q.id === runItemId ? { ...q, status: "running" as const, agent_session_id: runSessionId } : q,
    );
    return { ...agentPatch, queue, selectedItemId: state.selectedItemId ?? runItemId };
  });
}

export function handleAgentSessionId(
  payload: Record<string, unknown>,
  set: SetFn,
): void {
  const sidSlot = parseAgentSlot(payload);
  const ccSessionId = payload.claude_session_id as string;
  if (!ccSessionId) return;
  set(state => {
    const sidItemId = resolveItemId(state, sidSlot);
    return patchAgentByItemId(state, sidItemId, { claudeSessionId: ccSessionId });
  });
}

export function handleAgentUserMessage(
  payload: Record<string, unknown>,
  set: SetFn,
): void {
  const umSlot = parseAgentSlot(payload);
  const umContent = payload.content as string;
  if (!umContent) return;
  const userBlock = {
    id: `ws-user-${Date.now()}`,
    type: "user_message" as const,
    content: umContent,
    isError: false,
    createdAt: new Date().toISOString(),
  };
  set(state => {
    const umItemId = resolveItemId(state, umSlot);
    const existing = resolveAgentByItemId(state, umItemId);
    const agent = existing ?? createAgentSession(0, umSlot.type);
    const updated = { ...agent, blocks: [...agent.blocks, userBlock] };
    if (umItemId === PLAN_KEY) return { planAgent: updated };
    if (umItemId === PRD_KEY) return { prdAgent: updated };
    const activeAgents = new Map(state.activeAgents);
    activeAgents.set(umItemId, updated);
    return { activeAgents };
  });
}

export function handleUsageUpdate(
  payload: Record<string, unknown>,
  set: SetFn,
): void {
  const usageSlot = parseAgentSlot(payload);
  const inputTokens = (payload.input_tokens ?? 0) as number;
  const outputTokens = (payload.output_tokens ?? 0) as number;
  const contextWindow = (payload.context_window ?? 200_000) as number;
  set(state => {
    const usageItemId = resolveItemId(state, usageSlot);
    return patchAgentByItemId(state, usageItemId, { inputTokens, outputTokens, contextWindow });
  });
}

export function handlePermissionRequest(
  payload: Record<string, unknown>,
  set: SetFn,
): void {
  const permSlot = parseAgentSlot(payload);
  const toolName = payload.tool_name as string;
  const toolInput = (payload.tool_input ?? payload.input ?? {}) as Record<string, unknown>;
  const requestId = (payload.request_id ?? "") as string;

  if (toolName === "AskUserQuestion") {
    const questionPatch = {
      pendingQuestions: parseAskUserQuestions(toolInput),
      pendingQuestionToolInput: toolInput,
      pendingQuestionRequestId: requestId,
      pendingPermission: null,
    };
    set(state => {
      const itemId = resolveItemId(state, permSlot);
      if (itemId === PLAN_KEY && state.planAgent) {
        return { planAgent: { ...state.planAgent, ...questionPatch } };
      }
      if (itemId === PRD_KEY && state.prdAgent) {
        return { prdAgent: { ...state.prdAgent, ...questionPatch } };
      }
      const activeAgents = new Map(state.activeAgents);
      const agent = activeAgents.get(itemId);
      if (!agent) return {};
      activeAgents.set(itemId, { ...agent, ...questionPatch });
      return { activeAgents };
    });
    return;
  }

  const permission: PendingPermission = {
    toolName,
    input: toolInput,
    description: (payload.description ?? "") as string,
    pattern: (payload.pattern ?? "") as string,
    requestId,
  };
  set(state => {
    const itemId = resolveItemId(state, permSlot);
    if (itemId === PLAN_KEY && state.planAgent) {
      return { planAgent: { ...state.planAgent, pendingPermission: permission } };
    }
    if (itemId === PRD_KEY && state.prdAgent) {
      return { prdAgent: { ...state.prdAgent, pendingPermission: permission } };
    }
    const activeAgents = new Map(state.activeAgents);
    const agent = activeAgents.get(itemId);
    if (!agent) return {};
    activeAgents.set(itemId, { ...agent, pendingPermission: permission });
    return { activeAgents };
  });
}
