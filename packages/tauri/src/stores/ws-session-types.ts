/**
 * Types and helpers for WebSocket session state.
 */

import type { AgentBlockData } from "@/components/AgentBlock";
import type { TodoItem } from "@/types/agent";
import type { ContextUsageState } from "@/types/agent";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import type { AgentQuestion, AgentQuestionAnswers } from "@/components/AgentQuestionDrawer";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import type { WorktreeStatus } from "@/types/workflow";
import type { WsConnection } from "@/lib/ws-connection";
import type { WsEnvelope, SessionConfig } from "@/lib/ws-envelope";
import type { PermissionDecisionValue } from "@/components/ToolPermissionPrompt";
import type { StreamingState } from "./ws-message-processing";
import { createStreamingState } from "./ws-message-processing";
import type { TurnLifecycle } from "./ws-turn-lifecycle";
import { createIdleTurnLifecycle } from "./ws-turn-lifecycle";
import { DEFAULT_PROVIDER, FALLBACK_MODEL_ID } from "../shared/models";
import { defaultEditModeFor } from "../lib/provider-modes";
import type { PermissionMode } from "../types/permission-mode";

export type { PermissionMode };

export interface PendingPlanApproval {
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
  plan?: string;
}

export interface QueuedPrompt {
  text: string;
  images?: Array<{ base64: string; mimeType: string }>;
  useWorktree?: boolean;
}

/**
 * Provider-neutral transport health for the agent stream.
 *
 * Set from the `session.stream_status` WebSocket envelope (see
 * `ws-envelope-handler.ts::handleStreamStatus`). The backend emits this
 * for OpenCode today (other providers fall back to `"ok"`); the field is
 * intentionally provider-neutral so future providers can opt in without
 * touching shared frontend code.
 *
 * UI semantics (PR-A wires the state; PR-C will render the banner):
 * - `"ok"`: stream is healthy. No banner.
 * - `"degraded"`: dispatcher is reconnecting / stalled / reconcile failed.
 *   Render a "Reconnecting…" banner under the loader so the user is never
 *   left staring at a silent loader (matches `explicit-state.md`).
 *
 * Hard failures travel separately via the `session.error` envelope.
 */
export interface StreamHealth {
  state: "ok" | "degraded";
  /** Free-form human-readable reason; suitable for a tooltip. */
  reason?: string;
  /** `Date.now()` when the current state was entered. */
  since?: number;
}

export function createStreamHealth(): StreamHealth {
  return { state: "ok" };
}

// ---------------------------------------------------------------------------
// Per-session state
// ---------------------------------------------------------------------------

export interface SessionEntry {
  conn: WsConnection | null;
  isConnected: boolean;
  serverSessionId: string;
  lifecycle: TurnLifecycle;
  streamingState: StreamingState;
  blocks: AgentBlockData[];
  /**
   * Pre-filtered subset of `blocks` excluding subagent children. Maintained
   * incrementally inside `applyMutations` so that AgentStream consumers do
   * not re-derive it from `blocks` on every streamed chunk.
   */
  rootBlocks: AgentBlockData[];
  /**
   * Map from a tool_call's `toolUseId` to its `tool_result` block. Maintained
   * incrementally so AgentBlock can inline tool results without scanning the
   * whole conversation per render.
   */
  toolResultMap: Map<string, AgentBlockData>;
  pendingPermission: PendingPermission | null;
  pendingRequestId: string;
  pendingQuestions: AgentQuestion[];
  pendingQuestionToolInput: Record<string, unknown>;
  permissionMode: PermissionMode;
  currentThinkingEffort?: string;
  pendingPlanApproval: PendingPlanApproval | null;
  pendingManualCompact: boolean;
  currentProviderId: string;
  currentModelId: string;
  runtimeProvider: string;
  runtimeSessionId: string;
  persistedLoaded: boolean;
  contextUsage: ContextUsageState | null;
  hasFileChanges: boolean;
  slashCommands: SlashCommand[];
  slashCommandsLoading: boolean;
  slashCommandsKey: string | null;
  slashCommandsRequestRef: string | null;
  todos: TodoItem[];
  featureTitle: string | null;
  isAutoNaming: boolean;
  pendingWsRequests: Map<string, (payload: unknown) => void>;
  worktreeStatus: WorktreeStatus;
  worktreePath: string | null;
  worktreeBranch: string | null;
  worktreeSetupOutput: string[];
  worktreeError: string | null;
  hasMore: boolean;
  oldestMessageId: number | null;
  featureId: number | null;
  sessionDbId: number | null;
  queuedPrompts: QueuedPrompt[];
  /**
   * Transport health for the agent stream (driven by
   * `session.stream_status`). Provider-neutral; today only OpenCode
   * emits transitions away from `"ok"`. See `StreamHealth`.
   */
  streamHealth: StreamHealth;
}

export function createSessionEntry(): SessionEntry {
  return {
    conn: null,
    isConnected: false,
    serverSessionId: "",
    lifecycle: createIdleTurnLifecycle(),
    streamingState: createStreamingState(),
    blocks: [],
    rootBlocks: [],
    toolResultMap: new Map(),
    pendingPermission: null,
    pendingRequestId: "",
    pendingQuestions: [],
    pendingQuestionToolInput: {},
    permissionMode: defaultEditModeFor(DEFAULT_PROVIDER),
    currentThinkingEffort: undefined,
    pendingPlanApproval: null,
    pendingManualCompact: false,
    currentProviderId: DEFAULT_PROVIDER,
    currentModelId: FALLBACK_MODEL_ID,
    runtimeProvider: DEFAULT_PROVIDER,
    runtimeSessionId: "",
    persistedLoaded: false,
    contextUsage: null,
    hasFileChanges: false,
    slashCommands: [],
    slashCommandsLoading: false,
    slashCommandsKey: null,
    slashCommandsRequestRef: null,
    todos: [],
    featureTitle: null,
    isAutoNaming: false,
    pendingWsRequests: new Map(),
    worktreeStatus: "idle",
    worktreePath: null,
    worktreeBranch: null,
    worktreeSetupOutput: [],
    worktreeError: null,
    hasMore: false,
    oldestMessageId: null,
    featureId: null,
    sessionDbId: null,
    queuedPrompts: [],
    streamHealth: createStreamHealth(),
  };
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface WsSessionStore {
  sessions: Record<string, SessionEntry>;

  connect: (sessionId: string) => void;
  disconnect: (sessionId: string) => void;

  send: (sessionId: string, data: unknown) => void;
  initSession: (sessionId: string, config: SessionConfig) => void;
  sendPrompt: (
    sessionId: string,
    text: string,
    images?: Array<{ base64: string; mimeType: string }>,
    useWorktree?: boolean,
  ) => void;
  respondToPermission: (
    sessionId: string,
    requestId: string,
    decision: PermissionDecisionValue,
    feedback?: string,
  ) => void;
  respondToQuestion: (sessionId: string, response: AgentQuestionAnswers) => void;
  interrupt: (sessionId: string) => void;
  destroy: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
  compactSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  setProvider: (sessionId: string, providerId: string) => void;
  setModel: (sessionId: string, modelId: string) => void;
  setThinkingEffort: (sessionId: string, thinkingEffort?: string) => void;
  setPermissionMode: (sessionId: string, mode: PermissionMode) => void;
  approvePlan: (sessionId: string) => void;
  requestPlanChanges: (sessionId: string, feedback: string) => void;

  sendRequest: (sessionId: string, envelope: WsEnvelope) => Promise<unknown>;

  retryWorktreeSetup: (sessionId: string) => void;
  requestSlashCommands: (sessionId: string, cwd: string, provider?: string) => void;

  markPersistedLoaded: (sessionId: string) => void;
  setPersistedState: (
    sessionId: string,
    options: {
      blocks: AgentBlockData[];
      lifecycle: TurnLifecycle;
      hasMore?: boolean;
      oldestMessageId?: number | null;
      featureId?: number;
      sessionDbId?: number;
      currentProviderId?: string;
      currentModelId?: string;
      runtimeProvider?: string | null;
      runtimeSessionId?: string | null;
      pendingPlanApproval?: PendingPlanApproval | null;
      contextUsage?: ContextUsageState | null;
      hasFileChanges?: boolean;
      currentThinkingEffort?: string;
    },
  ) => void;
  /**
   * Loads older messages for a session. Resolves with the number of blocks
   * prepended to the conversation so callers can preserve scroll position
   * (e.g. Virtuoso's `firstItemIndex` decrement) without re-deriving the
   * delta from React state.
   */
  loadOlderMessages: (sessionId: string) => Promise<number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function updateSession(
  state: WsSessionStore,
  sessionId: string,
  patch: Partial<SessionEntry>,
): Partial<WsSessionStore> {
  const prev = state.sessions[sessionId];
  if (!prev) return {};
  return {
    sessions: {
      ...state.sessions,
      [sessionId]: { ...prev, ...patch },
    },
  };
}

export function markLastPlanBlock(
  blocks: AgentBlockData[],
  status: "approved" | "rejected",
): AgentBlockData[] {
  const lastIdx = blocks.findLastIndex(
    (b) =>
      b.type === "tool_call" &&
      (b.toolName === "ExitPlanMode" || b.toolName?.endsWith("__show_plan")),
  );
  if (lastIdx === -1) return blocks;
  const updated = [...blocks];
  updated[lastIdx] = { ...updated[lastIdx], planApprovalStatus: status };
  return updated;
}
