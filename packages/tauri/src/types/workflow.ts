/**
 * Workflow-specific type definitions and constants.
 *
 * Extracted from useWorkflowWebSocket to keep the store file focused on state management.
 */

import type { WsConnection } from "@/lib/ws-connection";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentQuestionAnswers } from "@/components/AgentQuestionDrawer";
import type { AgentStatus } from "@/types/agent";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import type { StreamingState } from "@/stores/ws-session-store";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import type { FeatureAgentStateResponse } from "@/api/generated";

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
  | "draft"
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
  iteration_count?: number;
  iteration_history?: string | null;
}

export interface AgentSessionState {
  sessionId: number;
  /** The agent type string (e.g. "session", "risk", "review-fixer"). */
  agentType: string;
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
  inputTokens: number;
  outputTokens: number;
  contextWindow: number;
  hasFileChanges: boolean;
  /** Whether older messages exist beyond current window */
  hasMore?: boolean;
  /** Lowest message ID in the current window */
  oldestMessageId?: number | null;
  /** Plan/PRD content for approval gates, persisted for app restart */
  pendingPlanApproval?: { plan?: string } | null;
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
  input_tokens: number;
  output_tokens: number;
  context_window: number;
}

export interface PlanSnapshot {
  id: number;
  name: string | null;
}

export interface WorktreeSnapshot {
  path: string;
  branch: string;
  status: string;
  setup_log?: string;
}

export interface FeatureSnapshot {
  workflow_status: WorkflowStatus;
  queue: QueueItem[];
  agent_sessions: AgentSessionSummary[];
  plan: PlanSnapshot | null;
  worktree: WorktreeSnapshot | null;
  autonomy_level: number;
}

export interface WorkflowState {
  // Connection
  conn: WsConnection | null;
  featureId: number | null;
  projectId: number | null;

  // Workflow state
  queue: QueueItem[];
  agents: Map<string, AgentSessionState>; // agentSlotKey → session state
  workflowStatus: WorkflowStatus;
  pauseReason: string | null;
  autonomyLevel: AutonomyLevel;
  selectedItemId: number | null;
  error: string | null;
  hydrated: boolean;

  // In-flight request flags (not optimistic state — just tracking pending requests)
  startingBuild: boolean;
  continuingBuild: boolean;
  startingSession: boolean;

  /** Live feature title pushed via WS after auto-naming. */
  featureTitle: string | null;

  // Slash commands
  slashCommands: SlashCommand[];
  slashCommandsLoading: boolean;
  requestSlashCommands: (cwd: string) => void;

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
  setParallelExecution: (enabled: boolean) => void;
  hydrateFromSnapshot: (snapshot: FeatureSnapshot, agentState?: FeatureAgentStateResponse) => void;

  // Outgoing messages
  startPlan: (description: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  startPrd: (description: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  approvePlan: (requestId?: string) => void;
  rejectPlan: (feedback: string, requestId?: string) => void;
  startBuild: () => void;
  continueWorkflow: () => void;
  skipItem: (itemId: number) => void;
  retryItem: (itemId: number) => void;
  retryWorktreeSetup: () => void;
  respondToPermission: (slotKey: string, requestId: string, decision: "allow_once" | "allow_future" | "deny") => void;
  respondToQuestion: (slotKey: string, response: AgentQuestionAnswers) => void;
  sendPromptToAgent: (slotKey: string, text: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  interruptItem: (slotKey: string) => void;
  resumeItem: (slotKey: string) => void;
  startSession: (prompt: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  startRefine: (description: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  startReviewFixer: (comments: string) => void;
  startRisk: () => void;
  startRetro: () => void;
  markDone: (slotKey: string) => void;
  removeAgent: (slotKey: string) => void;
  deleteSession: (sessionDbId: number) => void;
  clearError: () => void;

  populateAgentBlocks: (slotKey: string, blocks: AgentBlockData[], hasMore?: boolean, oldestMessageId?: number | null) => void;
  populateOlderBlocks: (slotKey: string, blocks: AgentBlockData[], hasMore: boolean, oldestMessageId: number | null) => void;
}

// ---------------------------------------------------------------------------
// AgentSlot – discriminated union matching the Rust AgentSlot enum
// ---------------------------------------------------------------------------

/** Discriminated union matching the Rust AgentSlot enum. */
export type AgentSlot =
  | { type: "plan" }
  | { type: "prd" }
  | { type: "session"; id: number }
  | { type: "refine" }
  | { type: "review-fixer"; id: number }
  | { type: "risk"; id: number }
  | { type: "retro"; id: number }
  | { type: "queue_item"; id: number };

/** Convert an AgentSlot to a stable string key for use as Map keys. */
export function agentSlotKey(slot: AgentSlot): string {
  if (slot.type === "queue_item") return `qi:${slot.id}`;
  if ("id" in slot && slot.id != null) return `${slot.type}:${slot.id}`;
  return slot.type;
}

/** Parse an agent_slot from a WS payload. Falls back to queue_item_id for backward compat. */
export function parseAgentSlot(payload: Record<string, unknown>): AgentSlot {
  if (payload.agent_slot) {
    return payload.agent_slot as AgentSlot;
  }
  // Backward compat: parse from legacy queue_item_id
  const id = payload.queue_item_id as number;
  return legacyIdToSlot(id);
}

/** Convert a legacy numeric ID to an AgentSlot (for backward compat with old WS payloads). */
function legacyIdToSlot(id: number): AgentSlot {
  switch (id) {
    case -1: return { type: "plan" };
    case -2: return { type: "prd" };
    case -3: return { type: "session", id: 0 };
    case -4: return { type: "refine" };
    case -5: return { type: "review-fixer", id: 0 };
    case -6: return { type: "risk", id: 0 };
    case -7: return { type: "retro", id: 0 };
    default: return { type: "queue_item", id };
  }
}

// ---------------------------------------------------------------------------
// String key constants for the unified agents Map
// ---------------------------------------------------------------------------

export const PLAN_KEY = "plan";
export const PRD_KEY = "prd";
export const SESSION_PLACEHOLDER_KEY = "session";

/** Convert a string slot key back to an AgentSlot for WS payloads. */
export function slotKeyToAgentSlot(slotKey: string): AgentSlot {
  if (slotKey === "plan") return { type: "plan" };
  if (slotKey === "prd") return { type: "prd" };
  if (slotKey === "refine") return { type: "refine" };
  if (slotKey === "session") return { type: "session", id: 0 };
  if (slotKey.startsWith("qi:")) return { type: "queue_item", id: parseInt(slotKey.slice(3), 10) };
  const colonIdx = slotKey.indexOf(":");
  if (colonIdx !== -1) {
    const type = slotKey.slice(0, colonIdx);
    const id = parseInt(slotKey.slice(colonIdx + 1), 10);
    return { type, id } as AgentSlot;
  }
  return { type: slotKey } as AgentSlot;
}
