/**
 * Workflow-specific type definitions and constants.
 *
 * Extracted from useWorkflowWebSocket to keep the store file focused on state management.
 */

import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentStatus } from "@/types/agent";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import type { StreamingState } from "@/stores/ws-session-store";
import type { SlashCommand } from "@/hooks/useSlashCommand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Workflow Phase types (custom workflow engine)
// ---------------------------------------------------------------------------

export type PhaseStatus = "pending" | "blocked" | "ready" | "running" | "completed" | "pending_approval" | "error";

export interface PhaseState {
  slug: string;
  status: PhaseStatus;
  agentSessionId: number | null;
  artifactPreview: string | null;
}

export interface PendingApproval {
  phaseSlug: string;
  artifactContent: string;
}

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

  // In-flight request flags (not optimistic state — just tracking pending requests)
  startingBuild: boolean;
  continuingBuild: boolean;
  startingSession: boolean;

  /** Live feature title pushed via WS after auto-naming. */
  featureTitle: string | null;

  // Custom workflow phase state
  workflowDefinitionId: number | null;
  phaseStates: Map<string, PhaseState>;
  pendingApproval: PendingApproval | null;

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
  retryWorktreeSetup: () => void;
  respondToPermission: (itemId: number, requestId: string, decision: "allow_once" | "allow_future" | "deny") => void;
  respondToQuestion: (itemId: number, response: string) => void;
  sendPromptToAgent: (itemId: number, text: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  interruptItem: (itemId: number) => void;
  resumeItem: (itemId: number) => void;
  startSession: (prompt: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  startRefine: (description: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  startReviewFixer: (comments: string) => void;
  startRisk: () => void;
  startRetro: () => void;
  markDone: (itemId: number) => void;
  removeAgent: (itemId: number) => void;
  deleteSession: (sessionDbId: number) => void;
  clearError: () => void;

  // Custom workflow actions
  approvePhase: (phaseSlug: string, approved: boolean, feedback?: string) => void;
  triggerPhase: (phaseSlug: string) => void;
  startCustomWorkflow: (featureId: number, projectId: number, title: string, workflowDefinitionId: number, description?: string, useWorktree?: boolean) => void;

  populateAgentBlocks: (itemId: number, blocks: AgentBlockData[], hasMore?: boolean, oldestMessageId?: number | null) => void;
  populateOlderBlocks: (itemId: number, blocks: AgentBlockData[], hasMore: boolean, oldestMessageId: number | null) => void;
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
  return slot.type === "queue_item" ? `qi:${slot.id}` : slot.type;
}

/** Convert an AgentSlot to the legacy numeric ID (for backward compat). */
export function agentSlotToLegacyId(slot: AgentSlot): number {
  switch (slot.type) {
    case "plan": return -1;
    case "prd": return -2;
    case "session": return -3;
    case "refine": return -4;
    case "review-fixer": return -5;
    case "risk": return -6;
    case "retro": return -7;
    case "queue_item": return slot.id;
  }
}

/** Convert a legacy numeric ID to an AgentSlot. */
export function legacyIdToSlot(id: number): AgentSlot {
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

/** Parse an agent_slot from a WS payload. Falls back to queue_item_id for backward compat. */
export function parseAgentSlot(payload: Record<string, unknown>): AgentSlot {
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
  risk: -6,
  retro: -7,
};

/** Shorthand constants for the most-used synthetic keys. */
export const PLAN_KEY = AGENT_TYPE_SYNTHETIC_KEYS.plan;       // -1
export const PRD_KEY = AGENT_TYPE_SYNTHETIC_KEYS.prd;         // -2
export const SESSION_KEY = AGENT_TYPE_SYNTHETIC_KEYS.session;  // -3
export const REVIEW_FIXER_KEY = AGENT_TYPE_SYNTHETIC_KEYS["review-fixer"]; // -5
