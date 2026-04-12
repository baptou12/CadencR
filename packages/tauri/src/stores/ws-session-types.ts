/**
 * Types and helpers for WebSocket session state.
 */

import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentStatus, TodoItem } from "@/types/agent";
import type { ContextUsageState } from "@/types/agent";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import type { AgentQuestion, AgentQuestionAnswers } from "@/components/AgentQuestionDrawer";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import type { WorktreeStatus } from "@/types/workflow";
import type { WsConnection } from "@/lib/ws-connection";
import type { WsEnvelope, SessionConfig } from "@/lib/ws-envelope";
import type { StreamingState } from "./ws-message-processing";
import { createStreamingState } from "./ws-message-processing";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../shared/models";

export type PermissionMode = "acceptEdits" | "plan";

export interface PendingPlanApproval {
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
  plan?: string;
}

export interface QueuedPrompt {
  text: string;
  images?: Array<{ base64: string; mimeType: string }>;
  useWorktree?: boolean;
}

// ---------------------------------------------------------------------------
// Per-session state
// ---------------------------------------------------------------------------

export interface SessionEntry {
  conn: WsConnection | null;
  isConnected: boolean;
  serverSessionId: string;
  streamingState: StreamingState;
  blocks: AgentBlockData[];
  status: AgentStatus;
  pendingPermission: PendingPermission | null;
  pendingRequestId: string;
  pendingQuestions: AgentQuestion[];
  pendingQuestionToolInput: Record<string, unknown>;
  permissionMode: PermissionMode;
  pendingPlanApproval: PendingPlanApproval | null;
  currentProviderId: string;
  currentModelId: string;
  runtimeProvider: string;
  runtimeSessionId: string;
  persistedLoaded: boolean;
  contextUsage: ContextUsageState | null;
  claudeSessionId: string;
  hasFileChanges: boolean;
  slashCommands: SlashCommand[];
  slashCommandsLoading: boolean;
  todos: TodoItem[];
  featureTitle: string | null;
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
}

export function createSessionEntry(): SessionEntry {
  return {
    conn: null,
    isConnected: false,
    serverSessionId: "",
    claudeSessionId: "",
    streamingState: createStreamingState(),
    blocks: [],
    status: "idle",
    pendingPermission: null,
    pendingRequestId: "",
    pendingQuestions: [],
    pendingQuestionToolInput: {},
    permissionMode: "acceptEdits",
    pendingPlanApproval: null,
    currentProviderId: DEFAULT_PROVIDER,
    currentModelId: DEFAULT_MODEL,
    runtimeProvider: DEFAULT_PROVIDER,
    runtimeSessionId: "",
    persistedLoaded: false,
    contextUsage: null,
    hasFileChanges: false,
    slashCommands: [],
    slashCommandsLoading: false,
    todos: [],
    featureTitle: null,
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
  sendPrompt: (sessionId: string, text: string, images?: Array<{ base64: string; mimeType: string }>, useWorktree?: boolean) => void;
  respondToPermission: (sessionId: string, requestId: string, granted: boolean) => void;
  respondToQuestion: (sessionId: string, response: AgentQuestionAnswers) => void;
  interrupt: (sessionId: string) => void;
  destroy: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  setProvider: (sessionId: string, providerId: string) => void;
  setModel: (sessionId: string, modelId: string) => void;
  setPermissionMode: (sessionId: string, mode: PermissionMode) => void;
  approvePlan: (sessionId: string) => void;
  requestPlanChanges: (sessionId: string, feedback: string) => void;

  sendRequest: (sessionId: string, envelope: WsEnvelope) => Promise<unknown>;

  retryWorktreeSetup: (sessionId: string) => void;
  requestSlashCommands: (sessionId: string, cwd: string) => void;

  markPersistedLoaded: (sessionId: string) => void;
  setPersistedState: (sessionId: string, options: {
    blocks: AgentBlockData[];
    status: AgentStatus;
    hasMore?: boolean;
    oldestMessageId?: number | null;
    featureId?: number;
    sessionDbId?: number;
    currentProviderId?: string;
    currentModelId?: string;
    runtimeProvider?: string | null;
    runtimeSessionId?: string | null;
    pendingPlanApproval?: PendingPlanApproval | null;
  }) => void;
  loadOlderMessages: (sessionId: string) => Promise<void>;
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
    (b) => b.type === "tool_call" && (b.toolName === "ExitPlanMode" || b.toolName?.endsWith("__show_plan")),
  );
  if (lastIdx === -1) return blocks;
  const updated = [...blocks];
  updated[lastIdx] = { ...updated[lastIdx], planApprovalStatus: status };
  return updated;
}
