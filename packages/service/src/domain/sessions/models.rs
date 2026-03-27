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
    #[serde(rename = "hasMore")]
    pub has_more: bool,
    #[serde(rename = "oldestMessageId")]
    pub oldest_message_id: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FeatureAgentStateResponse {
    pub sessions: Vec<SessionState>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_block_serde_roundtrip() {
        let block = AgentBlock {
            id: "msg-1".to_string(),
            type_: "text".to_string(),
            content: "hello".to_string(),
            tool_name: None,
            tool_args: None,
            is_error: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            child_blocks: None,
            source_tool_name: None,
            created_at: Some("2024-01-01".to_string()),
            model: None,
        };
        let json = serde_json::to_string(&block).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["id"], "msg-1");
        assert_eq!(parsed["type"], "text");
        assert_eq!(parsed["content"], "hello");
        assert_eq!(parsed["createdAt"], "2024-01-01");
        // None fields skipped
        assert!(parsed.get("toolName").is_none());
    }

    #[test]
    fn test_agent_block_tool_call_serde() {
        let block = AgentBlock {
            id: "msg-2".to_string(),
            type_: "tool_call".to_string(),
            content: "{\"cmd\":\"ls\"}".to_string(),
            tool_name: Some("Bash".to_string()),
            tool_args: Some("{\"cmd\":\"ls\"}".to_string()),
            is_error: None,
            tool_use_id: Some("tu-1".to_string()),
            parent_tool_use_id: None,
            child_blocks: None,
            source_tool_name: None,
            created_at: None,
            model: None,
        };
        let json = serde_json::to_string(&block).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["toolName"], "Bash");
        assert_eq!(parsed["toolUseId"], "tu-1");
        assert_eq!(parsed["toolArgs"], "{\"cmd\":\"ls\"}");
    }

    #[test]
    fn test_agent_block_nested_children() {
        let child = AgentBlock {
            id: "msg-child".to_string(),
            type_: "text".to_string(),
            content: "child content".to_string(),
            tool_name: None,
            tool_args: None,
            is_error: None,
            tool_use_id: None,
            parent_tool_use_id: Some("tu-task".to_string()),
            child_blocks: None,
            source_tool_name: None,
            created_at: None,
            model: None,
        };
        let parent = AgentBlock {
            id: "msg-task".to_string(),
            type_: "tool_call".to_string(),
            content: "{}".to_string(),
            tool_name: Some("Task".to_string()),
            tool_args: Some("{}".to_string()),
            is_error: None,
            tool_use_id: Some("tu-task".to_string()),
            parent_tool_use_id: None,
            child_blocks: Some(vec![child]),
            source_tool_name: None,
            created_at: None,
            model: None,
        };
        let json = serde_json::to_string(&parent).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let children = parsed["childBlocks"].as_array().unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0]["id"], "msg-child");
        assert_eq!(children[0]["parentToolUseId"], "tu-task");
    }

    #[test]
    fn test_draft_response_serde() {
        let resp = DraftResponse { draft_prompt: Some("draft".to_string()) };
        let json = serde_json::to_string(&resp).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["draftPrompt"], "draft");
    }

    #[test]
    fn test_save_draft_request_deserialization() {
        let json = r#"{"draft": "my draft text"}"#;
        let req: SaveDraftRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.draft.as_deref(), Some("my draft text"));

        let json_null = r#"{"draft": null}"#;
        let req_null: SaveDraftRequest = serde_json::from_str(json_null).unwrap();
        assert!(req_null.draft.is_none());
    }

}
