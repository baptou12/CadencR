/**
 * WS event handler for workflow-domain messages.
 *
 * All handleMessage logic extracted from useWorkflowWebSocket so the store
 * file can focus on state shape and actions.
 */

import type { AgentBlockData } from "@/components/AgentBlock";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import { parseAskUserQuestions } from "@/components/AgentQuestionDrawer";
import {
  createStreamingState,
  processSdkMessage,
  applyMutations,
} from "@/stores/ws-session-store";
import { invalidateFeatureQueries } from "@/lib/featureUpdated";
import { createCommandsGet, type CommandsListPayload } from "@/lib/ws-envelope";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import {
  type WorkflowState,
  type WorkflowStatus,
  type QueueItemStatus,
  type AgentSessionState,
  type AgentSlot,
  agentSlotKey as _agentSlotKey,
  agentSlotToLegacyId,
  legacyIdToSlot,
  parseAgentSlot,
  AGENT_TYPE_SYNTHETIC_KEYS,
  PLAN_KEY,
  PRD_KEY,
  SESSION_KEY,
} from "@/types/workflow";

// ---------------------------------------------------------------------------
// Agent session factory
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Slot / key helpers
// ---------------------------------------------------------------------------

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
function resolveMultiInstanceKey(slot: AgentSlot, sessionId: number): number {
  return MULTI_INSTANCE_TYPES.has(slot.type)
    ? sessionDbKey(sessionId)
    : agentSlotToLegacyId(slot);
}

// ---------------------------------------------------------------------------
// Block / stream helpers
// ---------------------------------------------------------------------------

export const FILE_CHANGE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

export function blocksContainFileChange(blocks: AgentBlockData[]): boolean {
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

// ---------------------------------------------------------------------------
// Agent state routing helpers
// ---------------------------------------------------------------------------

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
// Message handler factory
// ---------------------------------------------------------------------------

type SetFn = (
  partial: Partial<WorkflowState> | ((state: WorkflowState) => Partial<WorkflowState>),
) => void;

export function createWorkflowMessageHandler(
  set: SetFn,
  get: () => WorkflowState,
): (event: MessageEvent) => void {
  return function handleMessage(event: MessageEvent) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data as string);
    } catch {
      return;
    }

    const domain = data.domain as string;
    const action = data.action as string;
    const payload = (data.payload ?? {}) as Record<string, unknown>;

    // Handle cross-domain events before the workflow-only guard
    if (domain === "session" && action === "feature.renamed") {
      const title = payload.title as string | undefined;
      if (title) set({ featureTitle: title });
      return;
    }

    if (domain === "feature" && action === "updated") {
      const changed = (payload.changed ?? []) as string[];
      const featureId = get().featureId;
      if (featureId) invalidateFeatureQueries(featureId, changed);
      return;
    }

    if (domain === "commands" && action === "list") {
      const p = payload as unknown as CommandsListPayload;
      const cmds: SlashCommand[] = (p.commands ?? []).map((c) => ({
        name: c.name,
        description: c.description ?? "",
      }));
      set({ slashCommands: cmds, slashCommandsLoading: false });
      return;
    }

    if (domain !== "workflow") return;

    switch (action) {
      case "queue_update": {
        const items = payload.items as QueueItemStatus[];
        const updates: Record<string, unknown> = { queue: items ?? [] };
        if (payload.workflow_status) {
          updates.workflowStatus = payload.workflow_status as string;
        }
        set(updates);
        break;
      }
      case "item_update": {
        const id = payload.id as number;
        set(state => ({
          queue: state.queue.map(q =>
            q.id === id
              ? {
                  ...q,
                  status: (payload.status as QueueItemStatus) ?? q.status,
                  result: (payload.result as string | null) ?? q.result,
                  agent_session_id: (payload.agent_session_id as number | null) ?? q.agent_session_id,
                }
              : q,
          ),
        }));
        break;
      }
      case "item_started": {
        const slot = parseAgentSlot(payload);
        const itemId = agentSlotToLegacyId(slot);
        const sessionId = payload.session_id as number;
        set(state => {
          const queue = state.queue.map(q =>
            q.id === itemId ? { ...q, status: "running" as const, agent_session_id: sessionId } : q,
          );
          const activeAgents = new Map(state.activeAgents);
          const existing = activeAgents.get(itemId);
          const session = { ...createAgentSession(sessionId), blocks: existing?.blocks ?? [] };
          activeAgents.set(itemId, session);
          return { queue, activeAgents, selectedItemId: state.selectedItemId ?? itemId, startingSession: false };
        });
        break;
      }
      case "item_completed": {
        const slot = parseAgentSlot(payload);
        set(state => {
          const itemId = resolveItemId(state, slot);
          const queue = state.queue.map(q =>
            q.id === itemId ? { ...q, status: "completed" as const } : q,
          );
          return { queue, ...patchAgentByItemId(state, itemId, { status: "completed" }) };
        });
        break;
      }
      case "item_error": {
        const slot = parseAgentSlot(payload);
        const error = payload.error as string;
        set(state => {
          const itemId = resolveItemId(state, slot);
          const queue = state.queue.map(q =>
            q.id === itemId ? { ...q, status: "error" as const, result: error } : q,
          );
          return { queue, error, ...patchAgentByItemId(state, itemId, { status: "error" }) };
        });
        break;
      }
      case "item_retrying": {
        const itemId = payload.queue_item_id as number;
        const retryCount = payload.retry_count as number;
        const maxRetries = payload.max_retries as number;
        set(state => {
          const queue = state.queue.map(q =>
            q.id === itemId ? { ...q, status: "ready" as const, retry_count: retryCount, max_retries: maxRetries } : q,
          );
          return { queue };
        });
        break;
      }
      case "interrupted": {
        const slot = parseAgentSlot(payload);
        set(state => {
          const itemId = resolveItemId(state, slot);
          const agentPatch = patchAgentByItemId(state, itemId, { status: "paused" });
          if (itemId > 0) {
            const queue = state.queue.map(q =>
              q.id === itemId ? { ...q, status: "paused" as const } : q,
            );
            return { ...agentPatch, queue };
          }
          return agentPatch;
        });
        break;
      }
      case "paused": {
        const reason = payload.reason as string;
        set({ workflowStatus: "paused", pauseReason: reason });
        break;
      }
      case "status_update":
      case "status_changed": {
        const status = (payload.status as WorkflowStatus) ?? (payload.workflow_status as WorkflowStatus);
        if (status) {
          const previousStatus = (payload.previous_status as WorkflowStatus) ?? get().workflowStatus;
          const updates: Partial<WorkflowState> = { workflowStatus: status };

          if (previousStatus === "plan_approval" && status !== "plan_approval") {
            const planAgent = get().planAgent;
            if (planAgent) {
              updates.planAgent = { ...planAgent, status: "running" as const };
            }
          }

          if (previousStatus === "prd" && status === "planning") {
            const prdAgent = get().prdAgent;
            if (prdAgent && prdAgent.status === "paused") {
              updates.prdAgent = { ...prdAgent, status: "running" as const };
            }
          }

          if (status === "building" || status === "paused" || status === "error" || status === "completed") {
            updates.startingBuild = false;
            updates.continuingBuild = false;
            updates.startingSession = false;
          }

          set(updates);
        }
        break;
      }
      case "plan_agent_stream":
      case "prd_agent_stream": {
        const key = action === "plan_agent_stream" ? "planAgent" : "prdAgent";
        const msg = payload.message as Record<string, unknown>;
        if (!msg) break;
        set(state => {
          const agent = state[key as "planAgent" | "prdAgent"] ?? createAgentSession(0);
          return { [key]: processAgentStream(agent, msg) };
        });
        break;
      }
      case "plan_ready": {
        set(state => ({
          workflowStatus: "plan_approval",
          planAgent: state.planAgent ? { ...state.planAgent, status: "paused" as const } : state.planAgent,
        }));
        break;
      }
      case "plan_content":
      case "prd_content": {
        const content = payload.content as string;
        if (!content) break;
        const isPlan = action === "plan_content";
        const agentKey = isPlan ? "planAgent" : "prdAgent";
        const toolName = isPlan ? "__show_plan" : "__show_prd";
        const prefix = isPlan ? "plan" : "prd";
        set(state => {
          const agent = state[agentKey as "planAgent" | "prdAgent"] ?? createAgentSession(0);
          const block = {
            id: `ws-${prefix}-${Date.now()}`,
            type: "tool_call" as const,
            content: "",
            toolName,
            toolArgs: JSON.stringify({ plan: content }),
            createdAt: new Date().toISOString(),
          };
          return { [agentKey]: { ...agent, blocks: [...agent.blocks, block] } };
        });
        break;
      }
      case "prd_ready": {
        set(state => ({
          prdAgent: state.prdAgent ? { ...state.prdAgent, status: "paused" as const } : state.prdAgent,
        }));
        break;
      }
      case "session.started": {
        const sessionId = payload.session_id as number;
        const key = sessionDbKey(sessionId);
        set(state => {
          const activeAgents = new Map(state.activeAgents);
          const placeholder = activeAgents.get(SESSION_KEY);
          if (placeholder) {
            activeAgents.delete(SESSION_KEY);
          }
          const session = { ...createAgentSession(sessionId, "session"), blocks: placeholder?.blocks ?? [] };
          activeAgents.set(key, session);
          return { activeAgents };
        });
        break;
      }
      case "refine.started":
      case "risk.started":
      case "retro.started": {
        // These agents stream via plan_agent_stream / agent_stream; no extra state needed
        break;
      }
      case "agent_paused": {
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
        break;
      }
      case "agent_running": {
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
        break;
      }
      case "agent_session_id": {
        const sidSlot = parseAgentSlot(payload);
        const ccSessionId = payload.claude_session_id as string;
        if (!ccSessionId) break;
        set(state => {
          const sidItemId = resolveItemId(state, sidSlot);
          return patchAgentByItemId(state, sidItemId, { claudeSessionId: ccSessionId });
        });
        break;
      }
      case "agent_user_message": {
        const umSlot = parseAgentSlot(payload);
        const umContent = payload.content as string;
        if (!umContent) break;
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
        break;
      }
      case "agent_stream": {
        const streamSlot = parseAgentSlot(payload);
        const blocks = (payload.blocks ?? []) as Record<string, unknown>[];
        const singleMsg = payload.message as Record<string, unknown> | undefined;
        const msgs = blocks.length > 0 ? blocks : singleMsg ? [singleMsg] : [];
        if (msgs.length === 0) break;

        if (streamSlot.type === "plan" || streamSlot.type === "prd" || streamSlot.type === "refine") {
          const key = (streamSlot.type === "prd" ? "prdAgent" : "planAgent") as "planAgent" | "prdAgent";
          set(state => {
            let agent = state[key] ?? createAgentSession(0, streamSlot.type);
            for (const msg of msgs) {
              agent = processAgentStream(agent, msg);
            }
            return { [key]: agent };
          });
          break;
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
        break;
      }
      case "usage_update": {
        const usageSlot = parseAgentSlot(payload);
        const inputTokens = (payload.input_tokens ?? 0) as number;
        const outputTokens = (payload.output_tokens ?? 0) as number;
        const contextWindow = (payload.context_window ?? 200_000) as number;
        set(state => {
          const usageItemId = resolveItemId(state, usageSlot);
          return patchAgentByItemId(state, usageItemId, { inputTokens, outputTokens, contextWindow });
        });
        break;
      }
      case "permission.request": {
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
          break;
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
        break;
      }
      case "review_verdict": {
        // Informational — queue_update will follow with new items
        break;
      }
      case "review_fixer.started": {
        const sessionId = payload.session_id as number;
        set(state => {
          const activeAgents = new Map(state.activeAgents);
          activeAgents.set(sessionDbKey(sessionId), createAgentSession(sessionId, "review-fixer"));
          return { activeAgents };
        });
        break;
      }
      case "worktree.creating": {
        set({
          worktreeStatus: "creating",
          worktreeBranch: (payload.branch as string) ?? null,
          worktreePath: (payload.path as string) ?? null,
          worktreeError: null,
        });
        break;
      }
      case "worktree.created": {
        set({
          worktreeStatus: "created",
          worktreePath: (payload.path as string) ?? null,
          worktreeBranch: (payload.branch as string) ?? null,
        });
        break;
      }
      case "worktree.setup_running": {
        set({ worktreeStatus: "setup_running" });
        break;
      }
      case "worktree.setup_output": {
        const line = payload.line as string;
        if (line != null) {
          set(state => ({ worktreeSetupOutput: [...state.worktreeSetupOutput, line] }));
        }
        break;
      }
      case "worktree.ready": {
        set({ worktreeStatus: "ready" });
        break;
      }
      case "worktree.setup_error": {
        set({
          worktreeStatus: "setup_error",
          worktreeError: (payload.error ?? payload.message ?? "") as string,
        });
        break;
      }
      case "completed": {
        set({ workflowStatus: "completed" });
        break;
      }
      case "error": {
        set({
          workflowStatus: "error",
          error: payload.message as string,
          startingBuild: false,
          continuingBuild: false,
          startingSession: false,
        });
        break;
      }
    }
  };
}
