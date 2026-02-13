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

/** Synthetic event emitted when an agent is interrupted/paused */
export interface StreamAgentPaused {
  type: "agent_paused";
}

/** Synthetic event emitted when a session agent finishes a turn but stays alive */
export interface StreamTurnComplete {
  type: "turn_complete";
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
  | StreamTurnComplete;

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
}

/** Agent status info for listing */
export interface AgentInfo {
  id: string;
  agentType: string;
  status: string;
  startedAt: string;
}
