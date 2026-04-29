//! Database persistence for WebSocket sessions.
//!
//! Mirrors the logic in `SessionPersistence.ts` (Effect service) but implemented
//! in Rust using sqlx. All writes are best-effort — errors are logged but never
//! propagate to the caller so the WebSocket stream is not interrupted.

use sqlx::SqlitePool;
use std::collections::HashMap;
use tracing::{debug, error};

use crate::domain::agents::adapter::{
    RuntimeAssistantMessage, RuntimeContentBlock, RuntimeContentDelta, RuntimeEvent,
    RuntimeStreamEvent, RuntimeUserContentBlock, RuntimeUserMessage,
};

const INSERT_MESSAGE_SQL: &str =
    "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

/// A row from the `agent_sessions` table with the fields needed by the WS handler.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SessionRow {
    pub id: i64,
    pub feature_id: i64,
    pub runtime_provider: Option<String>,
    pub runtime_session_id: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub status: String,
    pub pending_plan_approval: Option<String>,
    pub pending_permission: Option<String>,
    pub pending_questions: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub context_window: Option<i64>,
    pub thinking_effort: Option<String>,
}

struct ToolInputBuffer {
    accumulated: String,
    replacement_candidate: Option<String>,
    merge_object_deltas: bool,
}

pub struct WsSessionPersistence {
    write_pool: SqlitePool,
    session_db_id: Option<i64>,
    feature_id: i64,
    current_models: HashMap<String, String>,
    /// (runtime_session_id, block_index) -> partial JSON being accumulated
    pending_tool_inputs: HashMap<(String, u64), ToolInputBuffer>,
    /// (runtime_session_id, block_index) -> agent_messages.id for the tool_call row
    pending_tool_row_ids: HashMap<(String, u64), i64>,
    file_change_marked: bool,
}

include!("persistence/session_bootstrap.rs");
include!("persistence/session_events.rs");
include!("persistence/session_error_messages.rs");
include!("persistence/session_tool_reconciliation.rs");
include!("persistence/session_subagents.rs");
include!("persistence/session_queries.rs");
include!("persistence/session_state.rs");
include!("persistence/pending_user_input.rs");
include!("persistence/session_archiving.rs");
include!("persistence/session_cleanup.rs");
