use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use std::collections::HashMap;

#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct AgentSessionRow {
    pub id: i64,
    pub feature_id: i64,
    pub agent_type: String,
    pub claude_session_id: Option<String>,
    pub status: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub run_id: Option<i64>,
    pub phase_id: Option<i64>,
    pub subprocess_id: Option<String>,
    pub model: Option<String>,
    pub pending_questions: Option<String>,
    pub has_file_changes: i64,
    pub permission_mode: Option<String>,
    pub pending_plan_approval: Option<String>,
    pub pending_prd_approval: Option<String>,
    pub pending_permission: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub context_window: Option<i64>,
    pub was_compacted: i64,
    pub draft_prompt: Option<String>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AgentMessageRow {
    pub id: i64,
    pub session_id: i64,
    pub content: String,
    pub message_type: String,
    pub tool_name: Option<String>,
    pub tool_use_id: Option<String>,
    pub parent_tool_use_id: Option<String>,
    pub created_at: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, Clone, ToSchema)]
pub struct AgentBlock {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub content: String,
    #[serde(rename = "toolName", skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(rename = "toolArgs", skip_serializing_if = "Option::is_none")]
    pub tool_args: Option<String>,
    #[serde(rename = "isError", skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    #[serde(rename = "toolUseId", skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    #[serde(rename = "parentToolUseId", skip_serializing_if = "Option::is_none")]
    pub parent_tool_use_id: Option<String>,
    /// Nested child blocks (for Task/Agent tool calls)
    #[serde(rename = "childBlocks", skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Vec<Object>>)]
    pub child_blocks: Option<Vec<AgentBlock>>,
    #[serde(rename = "sourceToolName", skip_serializing_if = "Option::is_none")]
    pub source_tool_name: Option<String>,
    #[serde(rename = "createdAt", skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SessionState {
    #[serde(rename = "sessionDbId")]
    pub session_db_id: i64,
    #[serde(rename = "agentType")]
    pub agent_type: String,
    pub status: String,
    #[serde(rename = "subprocessId")]
    pub subprocess_id: Option<String>,
    pub model: Option<String>,
    pub blocks: Vec<AgentBlock>,
    #[serde(rename = "maxMessageId")]
    pub max_message_id: i64,
    #[serde(rename = "isIncremental")]
    pub is_incremental: bool,
    #[serde(rename = "toolCallUpdates", skip_serializing_if = "Option::is_none")]
    pub tool_call_updates: Option<HashMap<String, String>>,
    #[serde(rename = "pendingQuestions")]
    pub pending_questions: Option<serde_json::Value>,
    #[serde(rename = "hasFileChanges")]
    pub has_file_changes: bool,
    pub resumable: bool,
    #[serde(rename = "claudeSessionId")]
    pub claude_session_id: Option<String>,
    #[serde(rename = "runId")]
    pub run_id: Option<i64>,
    #[serde(rename = "phaseId")]
    pub phase_id: Option<i64>,
    #[serde(rename = "phaseTitle")]
    pub phase_title: Option<String>,
    pub todos: Option<Vec<serde_json::Value>>,
    #[serde(rename = "permissionMode")]
    pub permission_mode: String,
    #[serde(rename = "pendingPlanApproval")]
    pub pending_plan_approval: Option<serde_json::Value>,
    #[serde(rename = "pendingPrdApproval")]
    pub pending_prd_approval: Option<serde_json::Value>,
    #[serde(rename = "pendingPermission")]
    pub pending_permission: Option<serde_json::Value>,
    #[serde(rename = "inputTokens")]
    pub input_tokens: i64,
    #[serde(rename = "outputTokens")]
    pub output_tokens: i64,
    #[serde(rename = "contextWindow")]
    pub context_window: i64,
    #[serde(rename = "wasCompacted")]
    pub was_compacted: bool,
    #[serde(rename = "draftPrompt")]
    pub draft_prompt: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FeatureAgentStateResponse {
    pub sessions: Vec<SessionState>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FeatureTurnState {
    pub feature_id: i64,
    pub turn: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TurnStatesResponse {
    pub states: HashMap<String, String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DraftResponse {
    #[serde(rename = "draftPrompt")]
    pub draft_prompt: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveDraftRequest {
    pub draft: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SaveDraftResponse {
    pub success: bool,
}

#[derive(Debug, sqlx::FromRow)]
pub struct PhaseTitle {
    pub id: i64,
    pub title: String,
}

#[derive(Debug, sqlx::FromRow)]
pub struct TurnStateRow {
    pub feature_id: i64,
    pub needs_input: i64,
}
