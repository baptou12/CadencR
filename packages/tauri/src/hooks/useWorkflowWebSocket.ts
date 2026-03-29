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
import type { AgentBlockData } from "@/components/AgentBlock";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import { parseAskUserQuestions, type AgentQuestion } from "@/components/AgentQuestionDrawer";
import {
  createStreamingState,
  processSdkMessage,
  applyMutations,
} from "@/stores/ws-session-store";
import { invalidateFeatureQueries } from "@/lib/featureUpdated";
import { createCommandsGet, type CommandsListPayload } from "@/lib/ws-envelope";
import type { SlashCommand } from "@/hooks/useSlashCommand";
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
  legacyIdToSlot,
  parseAgentSlot,
  AGENT_TYPE_SYNTHETIC_KEYS,
  PLAN_KEY,
  PRD_KEY,
  SESSION_KEY,
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

  function handleMessage(event: MessageEvent) {
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

    // Handle feature.updated events — invalidate React Query caches
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
        const items = payload.items as QueueItem[];
        const updates: Record<string, unknown> = { queue: items ?? [] };
        if (payload.workflow_status) {
          updates.workflowStatus = payload.workflow_status as string;
        }
        set(updates);
        break;
      }
      case "item_update": {
        // Differential update: patch a single item in the queue by id
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
          // Preserve blocks (e.g. user message) that arrived before this event
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
          // Use patchAgent helper so plan/prd (synthetic IDs) are handled too
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
          // Also update queue item status for positive IDs
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
          const updates: Partial<ReturnType<typeof get>> = { workflowStatus: status };

          // When leaving plan_approval, reset planAgent status back to "running"
          if (previousStatus === "plan_approval" && status !== "plan_approval") {
            const planAgent = get().planAgent;
            if (planAgent) {
              updates.planAgent = { ...planAgent, status: "running" as const };
            }
          }

          // When leaving prd status after prd approval, reset prdAgent status back to "running"
          // (prd_ready sets prdAgent.status to "paused"; transitioning away means approval resolved)
          // The agent will be marked "completed" by item_completed when it calls mark_agent_done.
          if (previousStatus === "prd" && status === "planning") {
            const prdAgent = get().prdAgent;
            if (prdAgent && prdAgent.status === "paused") {
              updates.prdAgent = { ...prdAgent, status: "running" as const };
            }
          }

          // Clear in-flight flags when we receive a status change
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
          const agent = state[key] ?? createAgentSession(0);
          return { [key]: processAgentStream(agent, msg) };
        });
        break;
      }
      case "plan_ready": {
        // Set status to "paused" (not "completed") so the agent panel stays open
        // and shows the plan approval bar. The agent is still running on the
        // backend but blocked on the approval gate.
        set(state => ({
          workflowStatus: "plan_approval",
          planAgent: state.planAgent ? { ...state.planAgent, status: "paused" as const } : state.planAgent,
        }));
        break;
      }
      case "plan_content":
      case "prd_content": {
        // Inject as a tool_call block so PlanBlock (blue card) renders markdown.
        // PlanBlock expects toolArgs = JSON { plan: "..." }.
        const content = payload.content as string;
        if (!content) break;
        const isPlan = action === "plan_content";
        const agentKey = isPlan ? "planAgent" : "prdAgent";
        const toolName = isPlan ? "__show_plan" : "__show_prd";
        const prefix = isPlan ? "plan" : "prd";
        set(state => {
          const agent = state[agentKey] ?? createAgentSession(0);
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
          // Check if there's a placeholder agent at the old SESSION_KEY and migrate it
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
      case "refine.started": {
        // Refine agent streams via plan_agent_stream (synthetic id -4)
        // planAgent is already set by startRefine()
        break;
      }
      case "risk.started": {
        // Risk agent uses synthetic id -6
        break;
      }
      case "retro.started": {
        // Retro agent uses synthetic id -7
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
        // Received when the backend captures the Claude Code session ID during streaming
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
        // Backend sends the initial user prompt so it's visible in the UI.
        // This may arrive before the "started" ack, so we ensure the agent exists.
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

          // Route to correct slot
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
        // The engine sends SDK messages in a `blocks` array
        const blocks = (payload.blocks ?? []) as Record<string, unknown>[];
        const singleMsg = payload.message as Record<string, unknown> | undefined;
        const msgs = blocks.length > 0 ? blocks : singleMsg ? [singleMsg] : [];
        if (msgs.length === 0) break;

        // Route plan/PRD agent streams to planAgent/prdAgent
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
          return patchAgentByItemId(state, usageItemId, {
            inputTokens,
            outputTokens,
            contextWindow,
          });
        });
        break;
      }
      case "permission.request": {
        const permSlot = parseAgentSlot(payload);
        const toolName = payload.tool_name as string;
        const toolInput = (payload.tool_input ?? payload.input ?? {}) as Record<string, unknown>;
        const requestId = (payload.request_id ?? "") as string;

        // AskUserQuestion: parse as questions (same as standalone session)
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
          // Handle plan/PRD agent permissions (synthetic IDs)
          if (itemId === PLAN_KEY && state.planAgent) {
            return { planAgent: { ...state.planAgent, pendingPermission: permission } };
          }
          if (itemId === PRD_KEY && state.prdAgent) {
            return { prdAgent: { ...state.prdAgent, pendingPermission: permission } };
          }
          // Queue agent permissions
          const activeAgents = new Map(state.activeAgents);
          const agent = activeAgents.get(itemId);
          if (!agent) return {};
          activeAgents.set(itemId, { ...agent, pendingPermission: permission });
          return { activeAgents };
        });
        break;
      }
      case "review_verdict": {
        // Review created fix phases — queue_update will follow with new items
        // The verdict is informational; queue items drive execution
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
          set(state => ({
            worktreeSetupOutput: [...state.worktreeSetupOutput, line],
          }));
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
        set({ workflowStatus: "error", error: payload.message as string, startingBuild: false, continuingBuild: false, startingSession: false });
        break;
      }
    }
  }

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
