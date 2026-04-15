/**
 * Agent-related WebSocket event helpers and handlers.
 *
 * All agents live in a single `agents: Map<string, AgentSessionState>` keyed
 * by `agentSlotKey(slot)`. No legacy numeric IDs.
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
  agentSlotKey,
  parseAgentSlot,
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
    runtimeSessionId: null,
    inputTokens: 0,
    outputTokens: 0,
    contextWindow: 200_000,
    hasFileChanges: false,
  };
}

// -- Slot key helpers --

/** Agent types that can have multiple concurrent instances. */
const MULTI_INSTANCE_TYPES = new Set(["session", "risk", "retro", "review-fixer"]);

/** Compute the agents Map key for an incoming WS event's slot + session_id. */
function slotKeyForEvent(slot: AgentSlot, sessionId?: number): string {
  if (slot.type === "queue_item") return agentSlotKey(slot);
  if (MULTI_INSTANCE_TYPES.has(slot.type) && sessionId != null) {
    return `${slot.type}:${sessionId}`;
  }
  return agentSlotKey(slot);
}

/** Find the agents Map key for a multi-instance slot, preferring running/paused agents. */
export function resolveSlotKey(
  agents: Map<string, AgentSessionState>,
  slot: AgentSlot,
): string {
  if (slot.type === "queue_item") return agentSlotKey(slot);
  if (!MULTI_INSTANCE_TYPES.has(slot.type)) return agentSlotKey(slot);
  // If slot has an id, use it directly
  if ("id" in slot && slot.id != null && slot.id !== 0) {
    return `${slot.type}:${slot.id}`;
  }
  // Search for a running/paused agent of this type
  let fallback: string | null = null;
  for (const [key, agent] of agents) {
    if (agent.agentType === slot.type) {
      if (agent.status === "running" || agent.status === "paused" || agent.status === "waiting") return key;
      if (fallback === null) fallback = key;
    }
  }
  return fallback ?? agentSlotKey(slot);
}

// -- Block / stream helpers --

const FILE_CHANGE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

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
  const { mutations } = processSdkMessage(msg, agent.streamingState);
  if (mutations.length === 0) return agent;
  const blocks = applyMutations(agent.blocks, mutations, agent.streamingState);
  const hasNewFileChange = !agent.hasFileChanges && mutations.some(
    (m) => m.action === "append" && m.block.type === "tool_call" && m.block.toolName && FILE_CHANGE_TOOLS.has(m.block.toolName),
  );
  return { ...agent, blocks, ...(hasNewFileChange ? { hasFileChanges: true } : {}) };
}

// -- Agent state routing helpers (unified) --

/** Resolve an agent from the agents Map by slot key. */
function resolveAgent(
  agents: Map<string, AgentSessionState>,
  slotKey: string,
): AgentSessionState | null {
  return agents.get(slotKey) ?? null;
}

/** Patch an agent in the agents Map. Returns a Zustand state patch. */
export function patchAgent(
  state: Pick<WorkflowState, "agents">,
  slotKey: string,
  patch: Partial<AgentSessionState>,
): Partial<WorkflowState> {
  const agent = state.agents.get(slotKey);
  if (!agent) return {};
  const agents = new Map(state.agents);
  agents.set(slotKey, { ...agent, ...patch });
  return { agents };
}

/** Like patchAgent but creates the agent if it doesn't exist. */
function upsertAgent(
  state: Pick<WorkflowState, "agents">,
  slotKey: string,
  sessionId: number,
  patch: Partial<AgentSessionState>,
): Partial<WorkflowState> {
  const agents = new Map(state.agents);
  const existing = agents.get(slotKey) ?? createAgentSession(sessionId);
  agents.set(slotKey, { ...existing, ...patch });
  return { agents };
}

/** Insert a fresh agent session, preserving any blocks that arrived before the .started event. */
export function insertAgentSession(
  state: Pick<WorkflowState, "agents">,
  slotKey: string,
  sessionId: number,
  agentType: string,
): { agents: Map<string, AgentSessionState> } {
  const agents = new Map(state.agents);
  const existing = agents.get(slotKey);
  agents.set(slotKey, { ...createAgentSession(sessionId, agentType), blocks: existing?.blocks ?? [] });
  return { agents };
}

// -- SetFn type --
export type SetFn = (
  partial: Partial<WorkflowState> | ((state: WorkflowState) => Partial<WorkflowState>),
) => void;

// -- Agent WS event handlers --

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
    const key = streamSlot.type === "prd" ? PRD_KEY : PLAN_KEY;
    set(state => {
      let agent = state.agents.get(key) ?? createAgentSession(0, streamSlot.type);
      for (const msg of msgs) {
        agent = processAgentStream(agent, msg);
      }
      const agents = new Map(state.agents);
      agents.set(key, agent);
      return { agents };
    });
    return;
  }

  set(state => {
    const slotKey = resolveSlotKey(state.agents, streamSlot);
    const agent = state.agents.get(slotKey);
    if (!agent) return state;
    let updated = agent;
    for (const msg of msgs) {
      updated = processAgentStream(updated, msg);
    }
    if (updated === agent) return state;
    const agents = new Map(state.agents);
    agents.set(slotKey, updated);
    return { agents };
  });
}

export function handleAgentPaused(
  payload: Record<string, unknown>,
  set: SetFn,
): void {
  const pausedSlot = parseAgentSlot(payload);
  const pausedSessionId = payload.session_id as number;
  const pausedRuntimeSessionId = (payload.runtime_session_id as string) || null;
  set(state => {
    const key = slotKeyForEvent(pausedSlot, pausedSessionId);
    return upsertAgent(state, key, pausedSessionId, {
      sessionId: pausedSessionId, status: "paused", runtimeSessionId: pausedRuntimeSessionId,
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
    const key = slotKeyForEvent(runSlot, runSessionId);
    const agentPatch = upsertAgent(state, key, runSessionId, {
      sessionId: runSessionId, status: "running", agentType: runSlot.type,
    });
    // Update queue item if this is a queue_item slot
    if (runSlot.type === "queue_item") {
      const queue = state.queue.map(q =>
        q.id === runSlot.id ? { ...q, status: "running" as const, agent_session_id: runSessionId } : q,
      );
      return { ...agentPatch, queue, selectedItemId: state.selectedItemId ?? runSlot.id };
    }
    return agentPatch;
  });
}

export function handleAgentSessionId(
  payload: Record<string, unknown>,
  set: SetFn,
): void {
  const sidSlot = parseAgentSlot(payload);
  const rtSessionId = payload.runtime_session_id as string;
  if (!rtSessionId) return;
  set(state => {
    const key = resolveSlotKey(state.agents, sidSlot);
    return patchAgent(state, key, { runtimeSessionId: rtSessionId });
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
    const key = resolveSlotKey(state.agents, umSlot);
    const existing = state.agents.get(key);
    const agent = existing ?? createAgentSession(0, umSlot.type);
    const updated = { ...agent, blocks: [...agent.blocks, userBlock] };
    const agents = new Map(state.agents);
    agents.set(key, updated);
    return { agents };
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
    const key = resolveSlotKey(state.agents, usageSlot);
    return patchAgent(state, key, { inputTokens, outputTokens, contextWindow });
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
      const key = resolveSlotKey(state.agents, permSlot);
      const agent = state.agents.get(key);
      if (!agent) return {};
      const agents = new Map(state.agents);
      agents.set(key, { ...agent, ...questionPatch });
      return { agents };
    });
    return;
  }

  const permission: PendingPermission = {
    toolName,
    input: toolInput,
    description: (payload.description ?? "") as string,
    pattern: (payload.pattern ?? "") as string,
    preview: typeof payload.preview === "string" ? payload.preview : undefined,
    options: Array.isArray(payload.options)
      ? payload.options as PendingPermission["options"]
      : [],
    requestId,
  };
  set(state => {
    const key = resolveSlotKey(state.agents, permSlot);
    const agent = state.agents.get(key);
    if (!agent) return {};
    const agents = new Map(state.agents);
    agents.set(key, { ...agent, pendingPermission: permission });
    return { agents };
  });
}
