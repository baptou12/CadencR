/**
 * Zustand store for workflow-specific WebSocket state.
 *
 * Manages the queue, active agent sessions, and workflow lifecycle.
 * Reuses processSdkMessage / applyMutations from ws-session-store for
 * all SDK message parsing — no duplication.
 */

import { create } from "zustand";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentStatus } from "@/types/agent";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import { parseAskUserQuestions, type AgentQuestion } from "@/components/AgentQuestionDrawer";
import {
  type StreamingState,
  createStreamingState,
  processSdkMessage,
  applyMutations,
} from "@/stores/ws-session-store";
import { invalidateFeatureQueries } from "@/lib/featureUpdated";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowStatus =
  | "idle"
  | "planning"
  | "prd"
  | "plan_approval"
  | "ready_to_build"
  | "building"
  | "paused"
  | "completed"
  | "error";

export type QueueItemStatus =
  | "pending"
  | "blocked"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "error"
  | "skipped";

export interface QueueItem {
  id: number;
  item_type: string;
  phase_id: number | null;
  phase_title: string | null;
  status: QueueItemStatus;
  order_index: number;
  group_index: number | null;
  agent_session_id: number | null;
  result: string | null;
  max_retries?: number;
  retry_count?: number;
}

export interface AgentSessionState {
  sessionId: number;
  blocks: AgentBlockData[];
  streamingState: StreamingState;
  status: AgentStatus;
  pendingPermission: PendingPermission | null;
  pendingQuestions: AgentQuestion[];
  pendingQuestionToolInput: Record<string, unknown>;
  pendingQuestionRequestId: string;
  historyLoaded: boolean;
  /** Claude Code CLI session ID (UUID) for --resume */
  claudeSessionId: string | null;
}

export type AutonomyLevel = 1 | 2 | 3;

export type WorktreeStatus =
  | "idle"
  | "creating"
  | "created"
  | "setup_running"
  | "ready"
  | "setup_error";

export interface AgentSessionSummary {
  id: number;
  queue_item_id: number | null;
  status: string;
  agent_type: string | null;
  claude_session_id: string | null;
}

export interface PlanSnapshot {
  id: number;
  name: string | null;
}

export interface WorktreeSnapshot {
  path: string;
  branch: string;
  status: string;
}

export interface FeatureSnapshot {
  workflow_status: WorkflowStatus;
  queue: QueueItem[];
  agent_sessions: AgentSessionSummary[];
  plan: PlanSnapshot | null;
  worktree: WorktreeSnapshot | null;
  autonomy_level: number;
}

interface WorkflowState {
  // Connection
  ws: WebSocket | null;
  featureId: number | null;
  projectId: number | null;

  // Workflow state
  queue: QueueItem[];
  activeAgents: Map<number, AgentSessionState>; // queue_item_id → session state
  planAgent: AgentSessionState | null;
  prdAgent: AgentSessionState | null;
  workflowStatus: WorkflowStatus;
  pauseReason: string | null;
  autonomyLevel: AutonomyLevel;
  selectedItemId: number | null;
  error: string | null;
  hydrated: boolean;

  /** Live feature title pushed via WS after auto-naming. */
  featureTitle: string | null;

  // Worktree state
  worktreeStatus: WorktreeStatus;
  worktreePath: string | null;
  worktreeBranch: string | null;
  worktreeSetupOutput: string[];
  worktreeError: string | null;

  // Actions
  connect: (featureId: number, projectId: number) => void;
  disconnect: () => void;
  selectItem: (itemId: number | null) => void;
  setAutonomyLevel: (level: AutonomyLevel) => void;
  hydrateFromSnapshot: (snapshot: FeatureSnapshot) => void;

  // Outgoing messages
  startPlan: (description: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  startPrd: (description: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  approvePlan: (requestId?: string) => void;
  rejectPlan: (feedback: string, requestId?: string) => void;
  startBuild: () => void;
  continueWorkflow: () => void;
  skipItem: (itemId: number) => void;
  retryItem: (itemId: number) => void;
  respondToPermission: (itemId: number, requestId: string, decision: "allow_once" | "allow_future" | "deny") => void;
  respondToQuestion: (itemId: number, response: string) => void;
  sendPromptToAgent: (itemId: number, text: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  interruptItem: (itemId: number) => void;
  resumeItem: (itemId: number) => void;
  startSession: (prompt: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  startRefine: (description: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  startReviewFixer: (comments: string) => void;
  markDone: (itemId: number) => void;
  removeAgent: (itemId: number) => void;
  populateAgentBlocks: (itemId: number, blocks: AgentBlockData[]) => void;
}

// ---------------------------------------------------------------------------
// AgentSlot – discriminated union matching the Rust AgentSlot enum
// ---------------------------------------------------------------------------

/** Discriminated union matching the Rust AgentSlot enum. */
export type AgentSlot =
  | { type: "plan" }
  | { type: "prd" }
  | { type: "session" }
  | { type: "refine" }
  | { type: "review_fixer" }
  | { type: "queue_item"; id: number };

/** Convert an AgentSlot to a stable string key for use as Map keys. */
export function agentSlotKey(slot: AgentSlot): string {
  return slot.type === "queue_item" ? `qi:${slot.id}` : slot.type;
}

/** Convert an AgentSlot to the legacy numeric ID (for backward compat). */
export function agentSlotToLegacyId(slot: AgentSlot): number {
  switch (slot.type) {
    case "plan": return -1;
    case "prd": return -2;
    case "session": return -3;
    case "refine": return -4;
    case "review_fixer": return -5;
    case "queue_item": return slot.id;
  }
}

/** Convert a legacy numeric ID to an AgentSlot. */
function legacyIdToSlot(id: number): AgentSlot {
  switch (id) {
    case -1: return { type: "plan" };
    case -2: return { type: "prd" };
    case -3: return { type: "session" };
    case -4: return { type: "refine" };
    case -5: return { type: "review_fixer" };
    default: return { type: "queue_item", id };
  }
}

/** Check if a slot is a pre-queue agent (not a queue item). */
function isPreQueueSlot(slot: AgentSlot): boolean {
  return slot.type !== "queue_item";
}

/** Parse an agent_slot from a WS payload. Falls back to queue_item_id for backward compat. */
function parseAgentSlot(payload: Record<string, unknown>): AgentSlot {
  if (payload.agent_slot) {
    return payload.agent_slot as AgentSlot;
  }
  // Backward compat: parse from legacy queue_item_id
  const id = payload.queue_item_id as number;
  return legacyIdToSlot(id);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @deprecated Use AgentSlot instead. Maps agent_type strings to synthetic queue-item IDs used by the WS protocol. */
export const AGENT_TYPE_SYNTHETIC_KEYS: Record<string, number> = {
  plan: -1,
  prd: -2,
  session: -3,
  refine: -4,
  "review-fixer": -5,
  review_fixer: -5,
};

/** Shorthand constants for the most-used synthetic keys. */
const PLAN_KEY = AGENT_TYPE_SYNTHETIC_KEYS.plan;       // -1
const PRD_KEY = AGENT_TYPE_SYNTHETIC_KEYS.prd;         // -2
const SESSION_KEY = AGENT_TYPE_SYNTHETIC_KEYS.session;  // -3
const REVIEW_FIXER_KEY = AGENT_TYPE_SYNTHETIC_KEYS["review-fixer"]; // -5

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWsUrl(): string {
  const httpUrl = window.api?.rustBackendUrl;
  if (httpUrl) {
    return httpUrl.replace(/^http/, "ws") + "/ws";
  }
  return "ws://localhost:5005/ws";
}

function createAgentSession(sessionId: number): AgentSessionState {
  return {
    sessionId,
    blocks: [],
    streamingState: createStreamingState(),
    status: "running",
    pendingPermission: null,
    pendingQuestions: [],
    pendingQuestionToolInput: {},
    pendingQuestionRequestId: "",
    historyLoaded: false,
    claudeSessionId: null,
  };
}

function processAgentStream(
  agent: AgentSessionState,
  msg: Record<string, unknown>,
): AgentSessionState {
  const mutations = processSdkMessage(msg, agent.streamingState);
  if (mutations.length === 0) return agent;
  const blocks = applyMutations(agent.blocks, mutations, agent.streamingState);
  return { ...agent, blocks };
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

    if (domain !== "workflow") return;

    switch (action) {
      case "queue_update": {
        const items = payload.items as QueueItem[];
        const updates: Record<string, unknown> = { queue: items ?? [], hydrated: true };
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
          return { queue, activeAgents, selectedItemId: state.selectedItemId ?? itemId };
        });
        break;
      }
      case "item_completed": {
        const slot = parseAgentSlot(payload);
        const itemId = agentSlotToLegacyId(slot);
        set(state => {
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
        const itemId = agentSlotToLegacyId(slot);
        const error = payload.error as string;
        set(state => {
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
        const itemId = agentSlotToLegacyId(slot);
        set(state => {
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
        if (status) set({ workflowStatus: status });
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
      case "plan_content": {
        // Inject the plan as a tool_call block so the existing PlanBlock (blue card)
        // renders it with markdown. PlanBlock expects toolArgs = JSON { plan: "..." }.
        const planContent = payload.content as string;
        if (!planContent) break;
        set(state => {
          const agent = state.planAgent ?? createAgentSession(0);
          const block = {
            id: `ws-plan-${Date.now()}`,
            type: "tool_call" as const,
            content: "",
            toolName: "__show_plan",
            toolArgs: JSON.stringify({ plan: planContent }),
            createdAt: new Date().toISOString(),
          };
          return { planAgent: { ...agent, blocks: [...agent.blocks, block] } };
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
        set(state => {
          const activeAgents = new Map(state.activeAgents);
          const existing = activeAgents.get(SESSION_KEY);
          // Preserve blocks (e.g. user message) that arrived before this ack
          const session = { ...createAgentSession(sessionId), blocks: existing?.blocks ?? [] };
          activeAgents.set(SESSION_KEY, session);
          return { activeAgents };
        });
        break;
      }
      case "refine.started": {
        // Refine agent streams via plan_agent_stream (synthetic id -4)
        // planAgent is already set by startRefine()
        break;
      }
      case "agent_paused": {
        // Received on reconnect when a pre-queue agent (plan/prd/session/refine) is resumable
        const pausedSlot = parseAgentSlot(payload);
        const pausedItemId = agentSlotToLegacyId(pausedSlot);
        const pausedSessionId = payload.session_id as number;
        const pausedClaudeSessionId = (payload.claude_session_id as string) || null;
        set(state => {
          const patch = { sessionId: pausedSessionId, status: "paused" as const, claudeSessionId: pausedClaudeSessionId };
          if (pausedItemId === PLAN_KEY) {
            const existing = state.planAgent ?? createAgentSession(pausedSessionId);
            return { planAgent: { ...existing, ...patch } };
          }
          if (pausedItemId === PRD_KEY) {
            const existing = state.prdAgent ?? createAgentSession(pausedSessionId);
            return { prdAgent: { ...existing, ...patch } };
          }
          const activeAgents = new Map(state.activeAgents);
          const existing = activeAgents.get(pausedItemId) ?? createAgentSession(pausedSessionId);
          activeAgents.set(pausedItemId, { ...existing, ...patch });
          return { activeAgents };
        });
        break;
      }
      case "agent_session_id": {
        // Received when the backend captures the Claude Code session ID during streaming
        const sidSlot = parseAgentSlot(payload);
        const sidItemId = agentSlotToLegacyId(sidSlot);
        const ccSessionId = payload.claude_session_id as string;
        if (!ccSessionId) break;
        set(state => patchAgentByItemId(state, sidItemId, { claudeSessionId: ccSessionId }));
        break;
      }
      case "agent_user_message": {
        // Backend sends the initial user prompt so it's visible in the UI.
        // This may arrive before the "started" ack, so we ensure the agent exists.
        const umSlot = parseAgentSlot(payload);
        const umItemId = agentSlotToLegacyId(umSlot);
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
          const existing = resolveAgentByItemId(state, umItemId);
          const agent = existing ?? createAgentSession(0);
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
        const itemId = agentSlotToLegacyId(streamSlot);
        // The engine sends SDK messages in a `blocks` array
        const blocks = (payload.blocks ?? []) as Record<string, unknown>[];
        const singleMsg = payload.message as Record<string, unknown> | undefined;
        const msgs = blocks.length > 0 ? blocks : singleMsg ? [singleMsg] : [];
        if (msgs.length === 0) break;

        // Route plan/PRD agent streams (synthetic IDs) to planAgent/prdAgent
        if (itemId === PLAN_KEY || itemId === PRD_KEY) {
          const key = itemId === PLAN_KEY ? "planAgent" : "prdAgent";
          set(state => {
            let agent = state[key] ?? createAgentSession(0);
            for (const msg of msgs) {
              agent = processAgentStream(agent, msg);
            }
            return { [key]: agent };
          });
          break;
        }

        set(state => {
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
      case "permission.request": {
        const permSlot = parseAgentSlot(payload);
        const itemId = agentSlotToLegacyId(permSlot);
        const toolName = payload.tool_name as string;
        const toolInput = (payload.tool_input ?? payload.input ?? {}) as Record<string, unknown>;
        const requestId = (payload.request_id ?? "") as string;

        // AskUserQuestion: parse as questions (same as standalone session)
        if (toolName === "AskUserQuestion") {
          const questions = parseAskUserQuestions(toolInput);
          const questionPatch = {
            pendingQuestions: questions,
            pendingQuestionToolInput: toolInput,
            pendingQuestionRequestId: requestId,
            pendingPermission: null,
          };
          set(state => {
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
          activeAgents.set(REVIEW_FIXER_KEY, createAgentSession(sessionId));
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
        set({ workflowStatus: "error", error: payload.message as string });
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
    autonomyLevel: 3,
    selectedItemId: null,
    error: null,
    hydrated: false,
    worktreeStatus: "idle",
    worktreePath: null,
    worktreeBranch: null,
    worktreeSetupOutput: [],
    worktreeError: null,
    featureTitle: null,

    connect(featureId, projectId) {
      const prev = get().ws;
      if (prev) prev.close();

      const ws = new WebSocket(getWsUrl());
      set({
        ws, featureId, projectId,
        queue: [], activeAgents: new Map(), planAgent: null, prdAgent: null,
        workflowStatus: "idle", pauseReason: null, selectedItemId: null, error: null, hydrated: false,
        worktreeStatus: "idle" as const, worktreePath: null, worktreeBranch: null, worktreeSetupOutput: [], worktreeError: null,
        featureTitle: null,
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
      // Don't overwrite if already hydrated or WS has delivered real-time data
      if (state.hydrated || state.queue.length > 0) return;

      const activeAgents = new Map(state.activeAgents);
      let planAgent: AgentSessionState | null = state.planAgent;
      let prdAgent: AgentSessionState | null = state.prdAgent;

      for (const session of snapshot.agent_sessions) {
        const agentState: AgentSessionState = {
          sessionId: session.id,
          blocks: [],
          streamingState: createStreamingState(),
          status: (session.status as AgentSessionState["status"]) ?? "idle",
          pendingPermission: null,
          pendingQuestions: [],
          pendingQuestionToolInput: {},
          pendingQuestionRequestId: "",
          historyLoaded: false,
          claudeSessionId: session.claude_session_id ?? null,
        };

        // Use queue_item_id when available; otherwise map agent_type to its
        // synthetic key (same IDs the WS protocol uses at runtime).
        const syntheticKey = session.queue_item_id
          ?? AGENT_TYPE_SYNTHETIC_KEYS[session.agent_type ?? ""]
          ?? (-1000 - session.id); // fallback avoids collision with -1..-5

        // Plan/prd go into dedicated state slots; everything else into activeAgents
        if (syntheticKey === PLAN_KEY && !planAgent) {
          planAgent = agentState;
        } else if (syntheticKey === PRD_KEY && !prdAgent) {
          prdAgent = agentState;
        } else {
          activeAgents.set(syntheticKey, agentState);
        }
      }

      const patch: Partial<WorkflowState> = {
        queue: snapshot.queue,
        workflowStatus: snapshot.workflow_status,
        autonomyLevel: (snapshot.autonomy_level as AutonomyLevel) ?? 3,
        activeAgents,
        planAgent,
        prdAgent,
        hydrated: true,
      };

      if (snapshot.worktree) {
        patch.worktreePath = snapshot.worktree.path;
        patch.worktreeBranch = snapshot.worktree.branch;
        patch.worktreeStatus = snapshot.worktree.status as WorktreeStatus;
      }

      set(patch);
    },

    selectItem(itemId) {
      set({ selectedItemId: itemId });
    },

    setAutonomyLevel(level) {
      set({ autonomyLevel: level });
      send("set_autonomy", { level });
    },

    startPlan(description, images) {
      set({ workflowStatus: "planning", planAgent: createAgentSession(0) });
      send("start_plan", { description, images });
    },

    startPrd(description, images) {
      set({ workflowStatus: "prd", prdAgent: createAgentSession(0) });
      send("start_prd", { description, images });
    },

    approvePlan(requestId) {
      send("plan.approved", { approved: true, request_id: requestId });
      // Agent resumes (permission bridge unblocks). Set back to "running" —
      // only item_completed should transition to "completed".
      set(state => ({
        workflowStatus: "building" as const,
        planAgent: state.planAgent ? { ...state.planAgent, status: "running" as const } : state.planAgent,
      }));
    },

    rejectPlan(feedback, requestId) {
      send("plan.rejected", { approved: false, feedback, request_id: requestId });
      // Agent resumes (permission bridge unblocks with Deny + feedback).
      set(state => ({
        workflowStatus: "planning" as const,
        planAgent: state.planAgent ? { ...state.planAgent, status: "running" as const } : state.planAgent,
      }));
    },

    startBuild() {
      send("start_build", {});
      set({ workflowStatus: "building" });
    },

    continueWorkflow() {
      send("continue", {});
      set({ workflowStatus: "building", pauseReason: null });
    },

    skipItem(itemId) {
      send("skip_item", { item_id: itemId });
      set(state => ({
        queue: state.queue.map(q => q.id === itemId ? { ...q, status: "skipped" as const } : q),
      }));
    },

    retryItem(itemId) {
      send("retry_item", { item_id: itemId });
    },

    respondToPermission(itemId, requestId, decision) {
      send("permission.respond", { agent_slot: legacyIdToSlot(itemId), request_id: requestId, decision });
      set(state => {
        const activeAgents = new Map(state.activeAgents);
        const agent = activeAgents.get(itemId);
        if (agent) activeAgents.set(itemId, { ...agent, pendingPermission: null });
        return { activeAgents };
      });
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
        agent_slot: legacyIdToSlot(itemId),
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
        const userBlock = {
          id: `ws-user-${Date.now()}`,
          type: "user_message" as const,
          content: text,
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
      send("prompt.send", { agent_slot: legacyIdToSlot(itemId), text, images });
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
      send("interrupt", { agent_slot: legacyIdToSlot(itemId) });
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
      send("prompt.send", { agent_slot: legacyIdToSlot(itemId), text: "", images: null });
    },

    startSession(prompt, images) {
      send("start_session", { prompt, images });
    },

    startRefine(description, images) {
      set({ workflowStatus: "planning", planAgent: createAgentSession(0) });
      send("start_refine", { description, images });
    },

    startReviewFixer(comments) {
      send("start_review_fixer", { comments });
    },

    markDone(itemId) {
      send("mark_done", { agent_slot: legacyIdToSlot(itemId) });
    },

    removeAgent(itemId) {
      set(state => {
        const activeAgents = new Map(state.activeAgents);
        activeAgents.delete(itemId);
        return { activeAgents };
      });
    },

    populateAgentBlocks(itemId, blocks) {
      set(state => {
        const agent = resolveAgentByItemId(state, itemId);
        if (!agent || agent.historyLoaded || agent.blocks.length > 0) return state;
        return patchAgentByItemId(state, itemId, { blocks, historyLoaded: true });
      });
    },
  };
});
