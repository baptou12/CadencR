/**
 * TypeScript types for Claude CLI stream-json events.
 * These represent the structured events emitted by `claude --output-format stream-json`.
 */

export type AgentType = "plan" | "brainstorm" | "execute" | "risk" | "review" | "session";

/** Message start event — beginning of an assistant turn */
export interface StreamMessageStart {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    model: string;
  };
}

/** Content block start — beginning of a content block (text, tool_use, etc.) */
export interface StreamContentBlockStart {
  type: "content_block_start";
  index: number;
  content_block:
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
}

/** Content block delta — incremental content update */
export interface StreamContentBlockDelta {
  type: "content_block_delta";
  index: number;
  delta:
    | { type: "text_delta"; text: string }
    | { type: "input_json_delta"; partial_json: string };
}

/** Content block stop — end of a content block */
export interface StreamContentBlockStop {
  type: "content_block_stop";
  index: number;
}

/** Message delta — message-level metadata update (e.g., stop_reason) */
export interface StreamMessageDelta {
  type: "message_delta";
  delta: {
    stop_reason: string | null;
  };
  usage?: {
    output_tokens: number;
  };
}

/** Message stop — end of a message turn */
export interface StreamMessageStop {
  type: "message_stop";
}

/** Tool result — result from a tool execution */
export interface StreamToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** Error event */
export interface StreamError {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

/** System event (e.g., session info) */
export interface StreamSystemEvent {
  type: "system";
  subtype: string;
  session_id?: string;
  [key: string]: unknown;
}

/** Result event — final event emitted by Claude CLI at end of session */
export interface StreamResult {
  type: "result";
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  [key: string]: unknown;
}

/** Synthetic event emitted when the agent subprocess exits */
export interface StreamAgentDone {
  type: "agent_done";
  exitCode: number | null;
}

/** Synthetic event emitted when an agent is paused */
export interface StreamAgentPaused {
  type: "agent_paused";
}

/** Synthetic event emitted when a session agent finishes a turn but stays alive */
export interface StreamTurnComplete {
  type: "turn_complete";
}

/** Synthetic event emitted when the execute orchestrator is waiting for user to continue (Level 2 autonomy) */
export interface StreamExecuteWaiting {
  type: "execute_waiting";
  nextStepNumber: number;
}

/** Union of all stream-json event types */
export type StreamEvent =
  | StreamMessageStart
  | StreamContentBlockStart
  | StreamContentBlockDelta
  | StreamContentBlockStop
  | StreamMessageDelta
  | StreamMessageStop
  | StreamToolResult
  | StreamError
  | StreamSystemEvent
  | StreamResult
  | StreamAgentDone
  | StreamAgentPaused
  | StreamTurnComplete
  | StreamExecuteWaiting
  | StreamUserMessage;

export interface StreamUserMessage {
  type: "user_message";
  content: string;
}

/** Agent event sent to the renderer via IPC */
export interface AgentEvent {
  /** The subprocess ID */
  subprocessId: string;
  /** The agent type */
  agentType: AgentType;
  /** The parsed stream event */
  event: StreamEvent;
  /** Timestamp */
  timestamp: number;
  /** Parent tool_use_id if this event comes from a subagent spawned by Task */
  parentToolUseId?: string | null;
  /** DB session ID (agent_sessions.id) for this subprocess */
  sessionDbId?: number;
  /** DB message ID (agent_messages.id) — used by frontend to deduplicate */
  messageDbId?: number;
}

/** Agent status info for listing */
export interface AgentInfo {
  id: string;
  agentType: string;
  status: string;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Unified agent configuration
// ---------------------------------------------------------------------------

/** An output pattern to match against accumulated agent output text. */
export interface OutputPattern {
  /** Regex to test against the full accumulated output */
  pattern: RegExp;
  /** Logical name for this match (e.g. "plan_complete", "review_approved") */
  event: string;
}

/** Context object passed to completion action handlers. */
export interface CompletionContext {
  /** The agent type that completed */
  agentType: AgentType;
  /** The subprocess exit code */
  exitCode: number;
  /** The database session ID */
  sessionDbId: number;
  /** The feature ID (if any) */
  featureId?: number;
  /** The project ID */
  projectId: number;
}

/** A completion action to run when the subprocess exits. */
export interface CompletionAction {
  /** Logical event name (for documentation / filtering) */
  event: string;
  /** Handler called with the full accumulated output and context */
  handler: (output: string, context: CompletionContext) => void | Promise<void>;
}

/**
 * Unified configuration for starting any agent type.
 *
 * All agent types (plan, brainstorm, execute, risk, review, session) can be
 * expressed as a UnifiedAgentConfig — the only differences are the system
 * prompt, output patterns, and completion actions.
 */
export interface UnifiedAgentConfig {
  /** The agent type identifier */
  agentType: AgentType;
  /** System prompt for the Claude session */
  systemPrompt?: string;
  /** Patterns to match against accumulated output during streaming */
  outputPatterns?: OutputPattern[];
  /** Actions to run when the subprocess exits */
  completionActions?: CompletionAction[];
  /** Feature ID (optional — sessions can run without a feature) */
  featureId?: number;
  /** Project ID */
  projectId: number;
  /** Working directory (project root or worktree path) */
  cwd: string;
  /** User prompt / initial message */
  prompt: string;
  /** Existing Claude session ID to resume */
  resumeSessionId?: string;
  /** Parent orchestrator session ID (for execute phase sessions) */
  runId?: number;
  /** Phase row ID this session is executing */
  phaseId?: number;
  /** Existing DB session ID to reuse (for resume — skips creating a new row) */
  existingSessionDbId?: number;
  /** Permission mode for the subprocess */
  permissionMode?: "bypassPermissions" | "plan";
}
