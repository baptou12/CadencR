use std::collections::HashMap;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::types::{
    CompactMetadata, ContentBlock, ContentDelta, McpServerStatus, PermissionDenial, PluginInfo,
    Usage,
};

// ── StreamEventData ──────────────────────────────────────────────────────────

/// Body of a `message_start` streaming event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageStartBody {
    pub id: String,
    pub model: String,
    #[serde(default)]
    pub usage: Option<Usage>,
    #[serde(rename = "type", default)]
    pub msg_type: Option<String>,
}

/// Body of a `message_delta` streaming event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageDeltaBody {
    pub stop_reason: Option<String>,
}

/// All streaming event subtypes. Tagged by the `type` field.
///
/// `ContentBlockDelta` is the **critical** one — it carries `TextDelta`,
/// `ThinkingDelta`, and `InputJsonDelta` for real-time UI streaming.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StreamEventData {
    /// Marks the start of a message; carries initial usage info.
    #[serde(rename = "message_start")]
    MessageStart { message: MessageStartBody },

    /// Marks the start of a content block (text, tool_use, thinking).
    #[serde(rename = "content_block_start")]
    ContentBlockStart {
        index: u32,
        content_block: ContentBlock,
    },

    /// **THE critical event.** Carries partial text / thinking / tool-input JSON.
    #[serde(rename = "content_block_delta")]
    ContentBlockDelta { index: u32, delta: ContentDelta },

    /// Marks the end of a content block.
    #[serde(rename = "content_block_stop")]
    ContentBlockStop { index: u32 },

    /// Carries stop_reason and optional updated usage at message end.
    #[serde(rename = "message_delta")]
    MessageDelta {
        delta: MessageDeltaBody,
        usage: Option<Usage>,
    },

    /// Marks the complete end of the streamed message.
    #[serde(rename = "message_stop")]
    MessageStop,
}

// ── SystemMessage ────────────────────────────────────────────────────────────

/// Typed `system` message subtypes. Tagged by the `subtype` field.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "subtype")]
pub enum SystemMessage {
    /// Session initialisation — carries session_id, model, tools, MCP servers.
    ///
    /// Cadence captures `session_id` from this for resume workflows.
    #[serde(rename = "init")]
    Init {
        uuid: String,
        session_id: String,
        claude_code_version: String,
        cwd: String,
        tools: Vec<String>,
        mcp_servers: Vec<McpServerStatus>,
        model: String,
        permission_mode: String,
        slash_commands: Vec<String>,
        output_style: String,
        #[serde(default)]
        skills: Vec<String>,
        #[serde(default)]
        plugins: Vec<PluginInfo>,
        #[serde(default)]
        agents: Option<Vec<String>>,
        #[serde(default)]
        betas: Option<Vec<String>>,
        #[serde(flatten)]
        extra: HashMap<String, Value>,
    },

    /// Marks a context compaction boundary.
    ///
    /// Cadence sets `was_compacted = true` when this is received.
    #[serde(rename = "compact_boundary")]
    CompactBoundary {
        uuid: String,
        session_id: String,
        compact_metadata: CompactMetadata,
    },
}

impl SystemMessage {
    /// Returns the `session_id` regardless of subtype.
    pub fn session_id(&self) -> &str {
        match self {
            SystemMessage::Init { session_id, .. } => session_id,
            SystemMessage::CompactBoundary { session_id, .. } => session_id,
        }
    }
}

// ── AssistantMessageBody ─────────────────────────────────────────────────────

/// Full assistant message body (emitted after a stream turn completes).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantMessageBody {
    pub id: String,
    pub content: Vec<ContentBlock>,
    pub model: String,
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub usage: Option<Usage>,
    #[serde(rename = "type", default)]
    pub msg_type: Option<String>,
}

// ── SdkMessage ───────────────────────────────────────────────────────────────

/// Tagged-union of every message the Claude Code CLI can emit.
///
/// Deserialization uses a custom impl that first tries the fully-typed tagged
/// enum, and on failure falls back to `Unknown(Value)` so the caller is never
/// handed a hard error for forward-compatibility reasons.
///
/// ## Turn management
///
/// | Variant | Cadence meaning |
/// |---------|-----------------|
/// | `StreamEvent` | Claude's turn — process content deltas in real-time |
/// | `Result` | Turn complete — session agents broadcast `turn_complete`; non-session agents close |
/// | `System(Init)` | Session started — capture `session_id` |
/// | `System(CompactBoundary)` | Context was compacted — set `was_compacted` flag |
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum SdkMessage {
    // === STREAMING (PRIMARY) =================================================
    /// **PRIMARY message type.** Real-time streaming deltas from the Anthropic API.
    ///
    /// Contains `content_block_delta` with `TextDelta`, `ThinkingDelta`, or
    /// `InputJsonDelta`. Also carries `message_start`, `message_stop`, etc.
    #[serde(rename = "stream_event")]
    StreamEvent {
        event: StreamEventData,
        parent_tool_use_id: Option<String>,
        uuid: String,
        session_id: String,
    },

    // === TURN SIGNALS (CRITICAL) =============================================
    /// Signals turn completion.
    ///
    /// `subtype` is one of `"success"`, `"error_max_turns"`,
    /// `"error_during_execution"`, etc.
    #[serde(rename = "result")]
    Result {
        subtype: String,
        uuid: String,
        session_id: String,
        duration_ms: u64,
        duration_api_ms: u64,
        is_error: bool,
        num_turns: u64,
        result: Option<String>,
        errors: Option<Vec<String>>,
        stop_reason: Option<String>,
        total_cost_usd: f64,
        usage: Usage,
        permission_denials: Vec<PermissionDenial>,
        structured_output: Option<Value>,
        #[serde(flatten)]
        extra: HashMap<String, Value>,
    },

    // === SESSION LIFECYCLE ===================================================
    /// System event (`init` or `compact_boundary`).
    #[serde(rename = "system")]
    System(SystemMessage),

    /// Full assistant message (emitted after stream completes for a turn).
    #[serde(rename = "assistant")]
    Assistant {
        uuid: String,
        session_id: String,
        message: AssistantMessageBody,
        parent_tool_use_id: Option<String>,
        error: Option<String>,
    },

    /// User message echo.
    #[serde(rename = "user")]
    User {
        uuid: Option<String>,
        session_id: String,
        message: Value,
        parent_tool_use_id: Option<String>,
        #[serde(default)]
        is_synthetic: Option<bool>,
        tool_use_result: Option<Value>,
        #[serde(default)]
        is_replay: Option<bool>,
    },

    // === OTHER VARIANTS ======================================================
    #[serde(rename = "status")]
    Status {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "hook_started")]
    HookStarted {
        uuid: String,
        session_id: String,
        hook_event: String,
        hook_id: String,
        matcher: Option<String>,
    },

    #[serde(rename = "hook_progress")]
    HookProgress {
        uuid: String,
        session_id: String,
        hook_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "hook_response")]
    HookResponse {
        uuid: String,
        session_id: String,
        hook_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "tool_progress")]
    ToolProgress {
        uuid: String,
        session_id: String,
        tool_use_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "auth_status")]
    AuthStatus {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "task_notification")]
    TaskNotification {
        uuid: String,
        session_id: String,
        task_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "task_started")]
    TaskStarted {
        uuid: String,
        session_id: String,
        task_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "task_progress")]
    TaskProgress {
        uuid: String,
        session_id: String,
        task_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "files_persisted")]
    FilesPersisted {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "tool_use_summary")]
    ToolUseSummary {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "rate_limit")]
    RateLimit {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "prompt_suggestion")]
    PromptSuggestion {
        uuid: String,
        session_id: String,
        suggestion: String,
    },

    /// Catch-all for any message type not yet typed.
    ///
    /// Preserves the raw JSON so callers can handle future CLI additions
    /// without crashing.
    #[serde(skip)]
    Unknown(Value),
}

// ── Custom Deserialize for SdkMessage ────────────────────────────────────────

/// Internal mirror of `SdkMessage` used by the derived deserializer.
/// We keep this private and convert into the public enum, adding the
/// `Unknown` fallback path.
#[derive(Deserialize)]
#[serde(tag = "type")]
enum SdkMessageInner {
    #[serde(rename = "stream_event")]
    StreamEvent {
        event: StreamEventData,
        parent_tool_use_id: Option<String>,
        uuid: String,
        session_id: String,
    },
    #[serde(rename = "result")]
    Result {
        subtype: String,
        uuid: String,
        session_id: String,
        duration_ms: u64,
        duration_api_ms: u64,
        is_error: bool,
        num_turns: u64,
        result: Option<String>,
        errors: Option<Vec<String>>,
        stop_reason: Option<String>,
        total_cost_usd: f64,
        usage: Usage,
        #[serde(default)]
        permission_denials: Vec<PermissionDenial>,
        structured_output: Option<Value>,
        #[serde(flatten)]
        extra: HashMap<String, Value>,
    },
    #[serde(rename = "system")]
    System(SystemMessage),
    #[serde(rename = "assistant")]
    Assistant {
        uuid: String,
        session_id: String,
        message: AssistantMessageBody,
        parent_tool_use_id: Option<String>,
        error: Option<String>,
    },
    #[serde(rename = "user")]
    User {
        uuid: Option<String>,
        session_id: String,
        message: Value,
        parent_tool_use_id: Option<String>,
        #[serde(default)]
        is_synthetic: Option<bool>,
        tool_use_result: Option<Value>,
        #[serde(default)]
        is_replay: Option<bool>,
    },
    #[serde(rename = "status")]
    Status {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },
    #[serde(rename = "hook_started")]
    HookStarted {
        uuid: String,
        session_id: String,
        hook_event: String,
        hook_id: String,
        matcher: Option<String>,
    },
    #[serde(rename = "hook_progress")]
    HookProgress {
        uuid: String,
        session_id: String,
        hook_id: String,
        #[serde(flatten)]
        data: Value,
    },
    #[serde(rename = "hook_response")]
    HookResponse {
        uuid: String,
        session_id: String,
        hook_id: String,
        #[serde(flatten)]
        data: Value,
    },
    #[serde(rename = "tool_progress")]
    ToolProgress {
        uuid: String,
        session_id: String,
        tool_use_id: String,
        #[serde(flatten)]
        data: Value,
    },
    #[serde(rename = "auth_status")]
    AuthStatus {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },
    #[serde(rename = "task_notification")]
    TaskNotification {
        uuid: String,
        session_id: String,
        task_id: String,
        #[serde(flatten)]
        data: Value,
    },
    #[serde(rename = "task_started")]
    TaskStarted {
        uuid: String,
        session_id: String,
        task_id: String,
        #[serde(flatten)]
        data: Value,
    },
    #[serde(rename = "task_progress")]
    TaskProgress {
        uuid: String,
        session_id: String,
        task_id: String,
        #[serde(flatten)]
        data: Value,
    },
    #[serde(rename = "files_persisted")]
    FilesPersisted {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },
    #[serde(rename = "tool_use_summary")]
    ToolUseSummary {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },
    #[serde(rename = "rate_limit")]
    RateLimit {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },
    #[serde(rename = "prompt_suggestion")]
    PromptSuggestion {
        uuid: String,
        session_id: String,
        suggestion: String,
    },
}

impl From<SdkMessageInner> for SdkMessage {
    fn from(inner: SdkMessageInner) -> Self {
        match inner {
            SdkMessageInner::StreamEvent {
                event,
                parent_tool_use_id,
                uuid,
                session_id,
            } => SdkMessage::StreamEvent {
                event,
                parent_tool_use_id,
                uuid,
                session_id,
            },
            SdkMessageInner::Result {
                subtype,
                uuid,
                session_id,
                duration_ms,
                duration_api_ms,
                is_error,
                num_turns,
                result,
                errors,
                stop_reason,
                total_cost_usd,
                usage,
                permission_denials,
                structured_output,
                extra,
            } => SdkMessage::Result {
                subtype,
                uuid,
                session_id,
                duration_ms,
                duration_api_ms,
                is_error,
                num_turns,
                result,
                errors,
                stop_reason,
                total_cost_usd,
                usage,
                permission_denials,
                structured_output,
                extra,
            },
            SdkMessageInner::System(s) => SdkMessage::System(s),
            SdkMessageInner::Assistant {
                uuid,
                session_id,
                message,
                parent_tool_use_id,
                error,
            } => SdkMessage::Assistant {
                uuid,
                session_id,
                message,
                parent_tool_use_id,
                error,
            },
            SdkMessageInner::User {
                uuid,
                session_id,
                message,
                parent_tool_use_id,
                is_synthetic,
                tool_use_result,
                is_replay,
            } => SdkMessage::User {
                uuid,
                session_id,
                message,
                parent_tool_use_id,
                is_synthetic,
                tool_use_result,
                is_replay,
            },
            SdkMessageInner::Status {
                uuid,
                session_id,
                data,
            } => SdkMessage::Status {
                uuid,
                session_id,
                data,
            },
            SdkMessageInner::HookStarted {
                uuid,
                session_id,
                hook_event,
                hook_id,
                matcher,
            } => SdkMessage::HookStarted {
                uuid,
                session_id,
                hook_event,
                hook_id,
                matcher,
            },
            SdkMessageInner::HookProgress {
                uuid,
                session_id,
                hook_id,
                data,
            } => SdkMessage::HookProgress {
                uuid,
                session_id,
                hook_id,
                data,
            },
            SdkMessageInner::HookResponse {
                uuid,
                session_id,
                hook_id,
                data,
            } => SdkMessage::HookResponse {
                uuid,
                session_id,
                hook_id,
                data,
            },
            SdkMessageInner::ToolProgress {
                uuid,
                session_id,
                tool_use_id,
                data,
            } => SdkMessage::ToolProgress {
                uuid,
                session_id,
                tool_use_id,
                data,
            },
            SdkMessageInner::AuthStatus {
                uuid,
                session_id,
                data,
            } => SdkMessage::AuthStatus {
                uuid,
                session_id,
                data,
            },
            SdkMessageInner::TaskNotification {
                uuid,
                session_id,
                task_id,
                data,
            } => SdkMessage::TaskNotification {
                uuid,
                session_id,
                task_id,
                data,
            },
            SdkMessageInner::TaskStarted {
                uuid,
                session_id,
                task_id,
                data,
            } => SdkMessage::TaskStarted {
                uuid,
                session_id,
                task_id,
                data,
            },
            SdkMessageInner::TaskProgress {
                uuid,
                session_id,
                task_id,
                data,
            } => SdkMessage::TaskProgress {
                uuid,
                session_id,
                task_id,
                data,
            },
            SdkMessageInner::FilesPersisted {
                uuid,
                session_id,
                data,
            } => SdkMessage::FilesPersisted {
                uuid,
                session_id,
                data,
            },
            SdkMessageInner::ToolUseSummary {
                uuid,
                session_id,
                data,
            } => SdkMessage::ToolUseSummary {
                uuid,
                session_id,
                data,
            },
            SdkMessageInner::RateLimit {
                uuid,
                session_id,
                data,
            } => SdkMessage::RateLimit {
                uuid,
                session_id,
                data,
            },
            SdkMessageInner::PromptSuggestion {
                uuid,
                session_id,
                suggestion,
            } => SdkMessage::PromptSuggestion {
                uuid,
                session_id,
                suggestion,
            },
        }
    }
}

impl<'de> Deserialize<'de> for SdkMessage {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        // Buffer the raw value so we can try again on failure.
        let raw = Value::deserialize(deserializer)?;
        match SdkMessageInner::deserialize(&raw) {
            Ok(inner) => Ok(SdkMessage::from(inner)),
            Err(_) => Ok(SdkMessage::Unknown(raw)),
        }
    }
}

// ── Helper methods ───────────────────────────────────────────────────────────

impl SdkMessage {
    /// Extract `session_id` from any message variant.
    pub fn session_id(&self) -> Option<&str> {
        match self {
            SdkMessage::StreamEvent { session_id, .. } => Some(session_id),
            SdkMessage::Result { session_id, .. } => Some(session_id),
            SdkMessage::System(s) => Some(s.session_id()),
            SdkMessage::Assistant { session_id, .. } => Some(session_id),
            SdkMessage::User { session_id, .. } => Some(session_id),
            SdkMessage::Status { session_id, .. } => Some(session_id),
            SdkMessage::HookStarted { session_id, .. } => Some(session_id),
            SdkMessage::HookProgress { session_id, .. } => Some(session_id),
            SdkMessage::HookResponse { session_id, .. } => Some(session_id),
            SdkMessage::ToolProgress { session_id, .. } => Some(session_id),
            SdkMessage::AuthStatus { session_id, .. } => Some(session_id),
            SdkMessage::TaskNotification { session_id, .. } => Some(session_id),
            SdkMessage::TaskStarted { session_id, .. } => Some(session_id),
            SdkMessage::TaskProgress { session_id, .. } => Some(session_id),
            SdkMessage::FilesPersisted { session_id, .. } => Some(session_id),
            SdkMessage::ToolUseSummary { session_id, .. } => Some(session_id),
            SdkMessage::RateLimit { session_id, .. } => Some(session_id),
            SdkMessage::PromptSuggestion { session_id, .. } => Some(session_id),
            SdkMessage::Unknown(_) => None,
        }
    }

    /// Returns `true` if this is a `Result` message, signalling turn completion.
    pub fn is_turn_complete(&self) -> bool {
        matches!(self, SdkMessage::Result { .. })
    }

    /// Returns `true` if this is a `StreamEvent` carrying a `content_block_delta`.
    pub fn is_content_delta(&self) -> bool {
        matches!(
            self,
            SdkMessage::StreamEvent {
                event: StreamEventData::ContentBlockDelta { .. },
                ..
            }
        )
    }

    /// Extract `Usage` for context-window tracking.
    ///
    /// Returns usage from `Assistant` messages only — these report per-API-call
    /// token counts that reflect the current context window fill level.
    /// `Result` message usage is **cumulative** across all turns and must NOT be
    /// used for context-window display (it would cause a spike when the agent
    /// finishes). `StreamEvent(MessageDelta)` usage is also excluded.
    pub fn usage(&self) -> Option<&Usage> {
        match self {
            SdkMessage::Assistant { message, .. } => message.usage.as_ref(),
            _ => None,
        }
    }

    /// Extract cumulative usage from the `Result` message (total across all turns).
    ///
    /// Use this for cost tracking / billing, NOT for context-window display.
    pub fn cumulative_usage(&self) -> Option<&Usage> {
        match self {
            SdkMessage::Result { usage, .. } => Some(usage),
            _ => None,
        }
    }

    /// Returns `true` if this is a `compact_boundary` system message.
    ///
    /// Cadence sets the `was_compacted` flag on the session when this is received.
    pub fn is_compaction(&self) -> bool {
        matches!(
            self,
            SdkMessage::System(SystemMessage::CompactBoundary { .. })
        )
    }
}
