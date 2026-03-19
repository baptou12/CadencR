use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Permission decision from the client.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    AllowOnce,
    AllowFuture,
    Deny,
}

/// Envelope — every message in both directions uses this shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsEnvelope {
    pub id: String,
    pub domain: String,
    pub action: String,
    #[serde(rename = "ref", skip_serializing_if = "Option::is_none")]
    pub r#ref: Option<String>,
    pub payload: serde_json::Value,
}

impl WsEnvelope {
    pub fn new(domain: impl Into<String>, action: impl Into<String>, payload: serde_json::Value) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            domain: domain.into(),
            action: action.into(),
            r#ref: None,
            payload,
        }
    }

    pub fn reply(original_id: &str, domain: impl Into<String>, action: impl Into<String>, payload: serde_json::Value) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            domain: domain.into(),
            action: action.into(),
            r#ref: Some(original_id.to_string()),
            payload,
        }
    }

    pub fn parse_action(&self) -> anyhow::Result<(&str, &str)> {
        if self.domain.is_empty() {
            anyhow::bail!("domain is required");
        }
        if self.action.is_empty() {
            anyhow::bail!("action is required");
        }
        Ok((&self.domain, &self.action))
    }
}

impl TryFrom<String> for WsEnvelope {
    type Error = anyhow::Error;

    fn try_from(value: String) -> anyhow::Result<Self> {
        let envelope: WsEnvelope = serde_json::from_str(&value)?;
        if envelope.domain.is_empty() {
            anyhow::bail!("domain is required");
        }
        if envelope.action.is_empty() {
            anyhow::bail!("action is required");
        }
        Ok(envelope)
    }
}

impl From<WsEnvelope> for String {
    fn from(envelope: WsEnvelope) -> Self {
        serde_json::to_string(&envelope).expect("WsEnvelope should always serialize")
    }
}

// --- Client → Server payloads ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInitPayload {
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub system_prompt: Option<String>,
    pub cwd: Option<String>,
    pub feature_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImagePayload {
    pub base64: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptSendPayload {
    pub session_id: String,
    pub text: String,
    #[serde(default)]
    pub images: Vec<ImagePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRespondPayload {
    pub session_id: String,
    pub request_id: String,
    pub decision: PermissionDecision,
    pub feedback: Option<String>,
    pub updated_input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionActionPayload {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSetPayload {
    pub session_id: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModeSetPayload {
    pub session_id: String,
    pub mode: String,
}

// --- Server → Client payloads ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionUsageUpdatePayload {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub context_window: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInitializedPayload {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMessagePayload {
    pub blocks: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequestPayload {
    pub request_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub description: Option<String>,
    /// Permission pattern for "allow future" persistence (e.g. "Read(/path)" or "Bash(git push:*)").
    pub pattern: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionErrorPayload {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEndedPayload {
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureRenamedPayload {
    pub feature_id: i64,
    pub title: String,
}

// --- Commands payloads ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandsGetPayload {
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlashCommandPayload {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandsListPayload {
    pub commands: Vec<SlashCommandPayload>,
}

/// Trait for workflow payloads that carry a feature_id, used by the
/// `parse_and_get_engine` helper to extract the id generically.
pub trait HasFeatureId {
    fn feature_id(&self) -> i64;
}

// --- Workflow payloads (Client → Server) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowFeatureStartPayload {
    pub feature_id: i64,
    pub project_id: Option<i64>,
    pub title: Option<String>,
    pub workflow_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowFeatureStartResponse {
    pub feature_id: i64,
    pub workflow_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStartPlanPayload {
    pub feature_id: i64,
    pub workflow_type: String,
    pub description: String,
    pub images: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStartPrdPayload {
    pub feature_id: i64,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowApprovalPayload {
    pub feature_id: i64,
    pub request_id: String,
    pub approved: bool,
    pub feedback: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowPopulateQueuePayload {
    pub feature_id: i64,
    pub plan_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStartBuildPayload {
    pub feature_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowContinuePayload {
    pub feature_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSkipItemPayload {
    pub feature_id: i64,
    pub item_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRetryItemPayload {
    pub feature_id: i64,
    pub item_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowPermissionRespondPayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
    pub request_id: String,
    pub decision: PermissionDecision,
    pub feedback: Option<String>,
    pub updated_input: Option<serde_json::Value>,
}

/// Server → Client: permission request from a workflow agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowPermissionRequestPayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
    pub request_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub description: Option<String>,
    pub pattern: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowPromptSendPayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
    pub text: String,
    pub images: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSetAutonomyPayload {
    pub feature_id: i64,
    pub level: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowInterruptPayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStartSessionPayload {
    pub feature_id: i64,
    pub prompt: String,
    pub images: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStartRefinePayload {
    pub feature_id: i64,
    pub description: String,
    pub images: Option<Vec<String>>,
}

// HasFeatureId impls for all workflow C→S payloads
macro_rules! impl_has_feature_id {
    ($($ty:ty),+ $(,)?) => {
        $(impl HasFeatureId for $ty {
            fn feature_id(&self) -> i64 { self.feature_id }
        })+
    };
}

impl_has_feature_id!(
    WorkflowFeatureStartPayload,
    WorkflowStartPlanPayload,
    WorkflowStartPrdPayload,
    WorkflowApprovalPayload,
    WorkflowPopulateQueuePayload,
    WorkflowStartBuildPayload,
    WorkflowContinuePayload,
    WorkflowSkipItemPayload,
    WorkflowRetryItemPayload,
    WorkflowPermissionRespondPayload,
    WorkflowPromptSendPayload,
    WorkflowSetAutonomyPayload,
    WorkflowInterruptPayload,
    WorkflowStartSessionPayload,
    WorkflowStartRefinePayload,
    WorkflowStartReviewFixerPayload,
    WorkflowMarkDonePayload,
);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStartReviewFixerPayload {
    pub feature_id: i64,
    pub comments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowMarkDonePayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
}

// --- Workflow payloads (Server → Client) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowItemEventPayload {
    pub feature_id: i64,
    pub item_id: i64,
    pub item_type: String,
    pub phase_title: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowAgentStartedPayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
    pub session_id: i64,
    pub agent_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowItemStartedPayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
    pub session_id: i64,
    pub item_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowItemCompletedPayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
    pub result: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowItemErrorPayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowItemSkippedPayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowPausedPayload {
    pub feature_id: i64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowQueueUpdatePayload {
    pub feature_id: i64,
    pub items: Vec<crate::domain::features::models::QueueItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowItemUpdatePayload {
    pub feature_id: i64,
    pub id: i64,
    pub status: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub result: Option<String>,
    pub agent_session_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowAgentStreamResultPayload {
    pub queue_item_id: i64,
    pub session_id: i64,
    #[serde(rename = "type")]
    pub msg_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowAgentStreamBlocksPayload {
    pub queue_item_id: i64,
    pub session_id: i64,
    pub blocks: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowAgentStreamErrorPayload {
    pub queue_item_id: i64,
    pub session_id: i64,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub error: String,
}

/// Ack payload for simple workflow replies (plan.started, prd.started, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowFeatureIdSessionPayload {
    pub feature_id: i64,
    pub session_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowApprovalResolvedPayload {
    pub feature_id: i64,
    pub approved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowQueuePopulatedPayload {
    pub feature_id: i64,
    pub item_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowAcknowledgedPayload {
    pub feature_id: i64,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowInterruptedPayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowAutonomyUpdatedPayload {
    pub feature_id: i64,
    pub level: u8,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_envelope_roundtrip() {
        let env = WsEnvelope::new("session", "init", serde_json::json!({"model": "opus"}));
        let json: String = env.clone().into();
        let parsed = WsEnvelope::try_from(json).unwrap();
        assert_eq!(parsed.domain, "session");
        assert_eq!(parsed.action, "init");
        assert_eq!(parsed.payload, serde_json::json!({"model": "opus"}));
    }

    #[test]
    fn test_try_from_valid() {
        let json = serde_json::json!({
            "id": "abc",
            "domain": "agent",
            "action": "prompt.send",
            "payload": {}
        }).to_string();
        let env = WsEnvelope::try_from(json).unwrap();
        assert_eq!(env.id, "abc");
        assert_eq!(env.domain, "agent");
    }

    #[test]
    fn test_try_from_missing_domain() {
        let json = serde_json::json!({
            "id": "abc",
            "domain": "",
            "action": "init",
            "payload": {}
        }).to_string();
        assert!(WsEnvelope::try_from(json).is_err());
    }

    #[test]
    fn test_try_from_missing_action() {
        let json = serde_json::json!({
            "id": "abc",
            "domain": "session",
            "action": "",
            "payload": {}
        }).to_string();
        assert!(WsEnvelope::try_from(json).is_err());
    }

    #[test]
    fn test_try_from_invalid_json() {
        assert!(WsEnvelope::try_from("not json".to_string()).is_err());
    }

    #[test]
    fn test_reply_sets_ref() {
        let original = WsEnvelope::new("session", "init", serde_json::json!({}));
        let reply = WsEnvelope::reply(&original.id, "session", "initialized", serde_json::json!({}));
        assert_eq!(reply.r#ref.as_deref(), Some(original.id.as_str()));
    }

    #[test]
    fn test_payload_types_roundtrip() {
        // SessionInitPayload
        let p = SessionInitPayload { model: Some("opus".into()), permission_mode: None, system_prompt: None, cwd: Some("/tmp".into()), feature_id: None };
        let v = serde_json::to_value(&p).unwrap();
        let _: SessionInitPayload = serde_json::from_value(v).unwrap();

        // PromptSendPayload
        let p = PromptSendPayload { session_id: "s1".into(), text: "hello".into(), images: vec![] };
        let v = serde_json::to_value(&p).unwrap();
        let _: PromptSendPayload = serde_json::from_value(v).unwrap();

        // PermissionRespondPayload
        let p = PermissionRespondPayload { session_id: "s1".into(), request_id: "r1".into(), decision: PermissionDecision::AllowOnce, feedback: None, updated_input: None };
        let v = serde_json::to_value(&p).unwrap();
        let _: PermissionRespondPayload = serde_json::from_value(v).unwrap();

        // SessionInitializedPayload
        let p = SessionInitializedPayload { session_id: "s1".into() };
        let v = serde_json::to_value(&p).unwrap();
        let _: SessionInitializedPayload = serde_json::from_value(v).unwrap();

        // SessionMessagePayload
        let p = SessionMessagePayload { blocks: vec![serde_json::json!({"type": "text"})] };
        let v = serde_json::to_value(&p).unwrap();
        let _: SessionMessagePayload = serde_json::from_value(v).unwrap();

        // PermissionRequestPayload
        let p = PermissionRequestPayload { request_id: "r1".into(), tool_name: "bash".into(), tool_input: serde_json::json!({}), description: Some("run cmd".into()), pattern: None };
        let v = serde_json::to_value(&p).unwrap();
        let _: PermissionRequestPayload = serde_json::from_value(v).unwrap();

        // ModeSetPayload
        let p = ModeSetPayload { session_id: "s1".into(), mode: "plan".into() };
        let v = serde_json::to_value(&p).unwrap();
        let _: ModeSetPayload = serde_json::from_value(v).unwrap();

        // SessionErrorPayload
        let p = SessionErrorPayload { code: "ERR".into(), message: "bad".into() };
        let v = serde_json::to_value(&p).unwrap();
        let _: SessionErrorPayload = serde_json::from_value(v).unwrap();

        // SessionEndedPayload
        let p = SessionEndedPayload { reason: "done".into() };
        let v = serde_json::to_value(&p).unwrap();
        let _: SessionEndedPayload = serde_json::from_value(v).unwrap();
    }
}
