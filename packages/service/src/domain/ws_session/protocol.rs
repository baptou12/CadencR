use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::agents::adapter::{RuntimePermissionDecision, RuntimePermissionOption};
use crate::domain::workflow::engine::AgentSlot;

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
    pub fn new(
        domain: impl Into<String>,
        action: impl Into<String>,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            domain: domain.into(),
            action: action.into(),
            r#ref: None,
            payload,
        }
    }

    pub fn reply(
        original_id: &str,
        domain: impl Into<String>,
        action: impl Into<String>,
        payload: serde_json::Value,
    ) -> Self {
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
    pub provider: Option<String>,
    pub model: Option<String>,
    pub thinking_effort: Option<String>,
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
    pub use_worktree: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRespondPayload {
    pub session_id: String,
    pub request_id: String,
    pub decision: PermissionDecision,
    pub option_id: Option<String>,
    pub feedback: Option<String>,
    pub updated_input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionActionPayload {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSetPayload {
    pub session_id: String,
    pub provider: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffortSetPayload {
    pub session_id: String,
    pub thinking_effort: Option<String>,
}

// --- Server → Client payloads ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionUsageUpdatePayload {
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Authoritative context window for the active model. `None` means
    /// "unknown until the provider reports one" — distinct from 0.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInitializedPayload {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
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
    pub preview: Option<String>,
    #[serde(default)]
    pub options: Vec<PermissionOptionPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionOptionPayload {
    pub decision: PermissionDecision,
    pub option_id: Option<String>,
    pub label: String,
    pub description: String,
    #[serde(default)]
    pub collect_feedback: bool,
}

impl From<RuntimePermissionOption> for PermissionOptionPayload {
    fn from(option: RuntimePermissionOption) -> Self {
        Self {
            decision: match option.decision {
                RuntimePermissionDecision::AllowOnce => PermissionDecision::AllowOnce,
                RuntimePermissionDecision::AllowFuture => PermissionDecision::AllowFuture,
                RuntimePermissionDecision::Deny => PermissionDecision::Deny,
            },
            option_id: option.option_id,
            label: option.label,
            description: option.description,
            collect_feedback: option.collect_feedback,
        }
    }
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

/// Discriminant for `SessionStreamStatusPayload`.
///
/// Hard failures stay on `session.error`; this enum only carries
/// transient transport-health transitions.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamStatusState {
    Degraded,
    Recovered,
}

/// Provider-neutral transport-health envelope for the agent stream.
///
/// Emitted by the WS bridge when the underlying runtime reports
/// `RuntimeEventKind::StreamStatus`. The frontend uses this to render a
/// "Reconnecting…" / "Recovered" banner under the loader so users never
/// see an infinite silent loader (plan findings 1, 2, 3, 8).
///
/// `reason` is opaque human-readable text suited for a tooltip (e.g.
/// `"reconnecting (attempt 3): connection refused"`, `"no heartbeat
/// for 60s"`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStreamStatusPayload {
    pub state: StreamStatusState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureRenamedPayload {
    pub feature_id: i64,
    pub title: String,
}

/// Server → Client: auto-naming is starting or finished for a feature.
/// Frontend replaces the title with a skeleton while `in_progress: true`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureAutoNamingPayload {
    pub feature_id: i64,
    pub in_progress: bool,
}

/// Server → Client: one or more aspects of a feature changed.
/// The frontend uses `changed` to selectively invalidate React Query caches.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureUpdatedPayload {
    pub feature_id: i64,
    pub changed: Vec<String>,
}

// --- Commands payloads ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandsGetPayload {
    pub cwd: String,
    /// Runtime provider for the active session (e.g. `"claude_code"`,
    /// `"opencode"`). Required so command discovery is scoped to the active
    /// provider instead of falling back to shared filesystem scans.
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlashCommandPayload {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub kind: SlashCommandKindPayload,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlashCommandKindPayload {
    Command,
    Skill,
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
    #[serde(default)]
    pub workflow_type: Option<String>,
    pub description: String,
    pub images: Option<Vec<ImagePayload>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStartPrdPayload {
    pub feature_id: i64,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowApprovalPayload {
    pub feature_id: i64,
    #[serde(default)]
    pub request_id: Option<String>,
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
    pub agent_slot: AgentSlot,
    pub request_id: String,
    pub decision: PermissionDecision,
    pub option_id: Option<String>,
    pub feedback: Option<String>,
    pub updated_input: Option<serde_json::Value>,
}

/// Server → Client: permission request from a workflow agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowPermissionRequestPayload {
    pub feature_id: i64,
    pub agent_slot: AgentSlot,
    pub request_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub description: Option<String>,
    pub pattern: Option<String>,
    pub preview: Option<String>,
    #[serde(default)]
    pub options: Vec<PermissionOptionPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowPromptSendPayload {
    pub feature_id: i64,
    pub agent_slot: AgentSlot,
    pub text: String,
    pub images: Option<Vec<ImagePayload>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSetAutonomyPayload {
    pub feature_id: i64,
    pub level: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSetParallelPayload {
    pub feature_id: i64,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowInterruptPayload {
    pub feature_id: i64,
    pub agent_slot: AgentSlot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStartSessionPayload {
    pub feature_id: i64,
    pub prompt: String,
    pub images: Option<Vec<ImagePayload>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStartRefinePayload {
    pub feature_id: i64,
    pub description: String,
    pub images: Option<Vec<ImagePayload>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStartRiskPayload {
    pub feature_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStartRetroPayload {
    pub feature_id: i64,
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
    WorkflowSetParallelPayload,
    WorkflowInterruptPayload,
    WorkflowStartSessionPayload,
    WorkflowStartRefinePayload,
    WorkflowStartReviewFixerPayload,
    WorkflowStartRiskPayload,
    WorkflowStartRetroPayload,
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
    pub agent_slot: AgentSlot,
}

// --- Workflow payloads (Server → Client) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowAgentStartedPayload {
    pub feature_id: i64,
    pub agent_slot: AgentSlot,
    pub session_id: i64,
    pub agent_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowAgentPausedPayload {
    pub feature_id: i64,
    pub agent_slot: AgentSlot,
    pub session_id: i64,
    pub agent_type: String,
    pub runtime_session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowItemStartedPayload {
    pub feature_id: i64,
    pub agent_slot: AgentSlot,
    pub session_id: i64,
    pub item_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowItemCompletedPayload {
    pub feature_id: i64,
    pub agent_slot: AgentSlot,
    pub result: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowItemErrorPayload {
    pub feature_id: i64,
    pub agent_slot: AgentSlot,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowItemRetryingPayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
    pub retry_count: i64,
    pub max_retries: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowItemIteratingPayload {
    pub feature_id: i64,
    pub queue_item_id: i64,
    pub iteration_count: i64,
    pub max_iterations: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowItemSkippedPayload {
    pub feature_id: i64,
    pub agent_slot: AgentSlot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowPausedPayload {
    pub feature_id: i64,
    pub reason: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowPhaseCompletedPayload {
    pub feature_id: i64,
    pub phase_slug: String,
    pub artifact_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowApprovalRequestedPayload {
    pub feature_id: i64,
    pub phase_slug: String,
    pub artifact_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStatusChangedPayload {
    pub feature_id: i64,
    pub status: String,
    pub previous_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowQueueUpdatePayload {
    pub feature_id: i64,
    pub items: Vec<crate::domain::features::models::QueueItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_status: Option<String>,
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
    pub agent_slot: AgentSlot,
    pub session_id: i64,
    #[serde(rename = "type")]
    pub msg_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowAgentStreamBlocksPayload {
    pub agent_slot: AgentSlot,
    pub session_id: i64,
    pub blocks: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowAgentStreamErrorPayload {
    pub agent_slot: AgentSlot,
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
    pub agent_slot: AgentSlot,
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
        })
        .to_string();
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
        })
        .to_string();
        assert!(WsEnvelope::try_from(json).is_err());
    }

    #[test]
    fn test_try_from_missing_action() {
        let json = serde_json::json!({
            "id": "abc",
            "domain": "session",
            "action": "",
            "payload": {}
        })
        .to_string();
        assert!(WsEnvelope::try_from(json).is_err());
    }

    #[test]
    fn test_try_from_invalid_json() {
        assert!(WsEnvelope::try_from("not json".to_string()).is_err());
    }

    #[test]
    fn test_reply_sets_ref() {
        let original = WsEnvelope::new("session", "init", serde_json::json!({}));
        let reply = WsEnvelope::reply(
            &original.id,
            "session",
            "initialized",
            serde_json::json!({}),
        );
        assert_eq!(reply.r#ref.as_deref(), Some(original.id.as_str()));
    }

    #[test]
    fn test_payload_types_roundtrip() {
        // SessionInitPayload
        let p = SessionInitPayload {
            provider: None,
            model: Some("opus".into()),
            thinking_effort: None,
            permission_mode: None,
            system_prompt: None,
            cwd: Some("/tmp".into()),
            feature_id: None,
        };
        let v = serde_json::to_value(&p).unwrap();
        let _: SessionInitPayload = serde_json::from_value(v).unwrap();

        // PromptSendPayload
        let p = PromptSendPayload {
            session_id: "s1".into(),
            text: "hello".into(),
            images: vec![],
            use_worktree: None,
        };
        let v = serde_json::to_value(&p).unwrap();
        let _: PromptSendPayload = serde_json::from_value(v).unwrap();

        // CommandsGetPayload
        let p = CommandsGetPayload {
            cwd: "/tmp".into(),
            provider: "codex_cli".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        let _: CommandsGetPayload = serde_json::from_value(v).unwrap();

        // PermissionRespondPayload
        let p = PermissionRespondPayload {
            session_id: "s1".into(),
            request_id: "r1".into(),
            decision: PermissionDecision::AllowOnce,
            option_id: None,
            feedback: None,
            updated_input: None,
        };
        let v = serde_json::to_value(&p).unwrap();
        let _: PermissionRespondPayload = serde_json::from_value(v).unwrap();

        // SessionInitializedPayload
        let p = SessionInitializedPayload {
            session_id: "s1".into(),
            provider: None,
            model: None,
            thinking_effort: None,
            input_tokens: None,
            output_tokens: None,
            context_window: None,
        };
        let v = serde_json::to_value(&p).unwrap();
        let _: SessionInitializedPayload = serde_json::from_value(v).unwrap();

        // SessionMessagePayload
        let p = SessionMessagePayload {
            blocks: vec![serde_json::json!({"type": "text"})],
        };
        let v = serde_json::to_value(&p).unwrap();
        let _: SessionMessagePayload = serde_json::from_value(v).unwrap();

        // PermissionRequestPayload
        let p = PermissionRequestPayload {
            request_id: "r1".into(),
            tool_name: "bash".into(),
            tool_input: serde_json::json!({}),
            description: Some("run cmd".into()),
            pattern: None,
            preview: Some("ls".into()),
            options: vec![PermissionOptionPayload {
                decision: PermissionDecision::AllowOnce,
                option_id: None,
                label: "Allow once".into(),
                description: "Approve this tool call only".into(),
                collect_feedback: false,
            }],
        };
        let v = serde_json::to_value(&p).unwrap();
        let _: PermissionRequestPayload = serde_json::from_value(v).unwrap();

        // ModeSetPayload
        let p = ModeSetPayload {
            session_id: "s1".into(),
            mode: "plan".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        let _: ModeSetPayload = serde_json::from_value(v).unwrap();

        // SessionErrorPayload
        let p = SessionErrorPayload {
            code: "ERR".into(),
            message: "bad".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        let _: SessionErrorPayload = serde_json::from_value(v).unwrap();

        // SessionEndedPayload
        let p = SessionEndedPayload {
            reason: "done".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        let _: SessionEndedPayload = serde_json::from_value(v).unwrap();
    }

    #[test]
    fn test_start_plan_payload_without_workflow_type() {
        // The frontend doesn't send workflow_type — it must deserialize without it
        let json = serde_json::json!({
            "feature_id": 42,
            "description": "implement dark mode",
            "images": []
        });
        let p: WorkflowStartPlanPayload = serde_json::from_value(json).unwrap();
        assert_eq!(p.feature_id, 42);
        assert_eq!(p.description, "implement dark mode");
        assert!(p.workflow_type.is_none());
    }

    #[test]
    fn test_start_plan_payload_with_workflow_type() {
        // workflow_type is still accepted when provided
        let json = serde_json::json!({
            "feature_id": 42,
            "workflow_type": "feature_build",
            "description": "implement dark mode"
        });
        let p: WorkflowStartPlanPayload = serde_json::from_value(json).unwrap();
        assert_eq!(p.workflow_type.as_deref(), Some("feature_build"));
    }

    // --- Workflow payload serialization/deserialization tests ---

    #[test]
    fn test_workflow_feature_start_payload_roundtrip() {
        let p = WorkflowFeatureStartPayload {
            feature_id: 42,
            project_id: Some(7),
            title: Some("Dark mode".into()),
            workflow_type: Some("feature_build".into()),
        };
        let v = serde_json::to_value(&p).unwrap();
        let deserialized: WorkflowFeatureStartPayload = serde_json::from_value(v).unwrap();
        assert_eq!(deserialized.feature_id, 42);
        assert_eq!(deserialized.project_id, Some(7));
        assert_eq!(deserialized.title.as_deref(), Some("Dark mode"));
        assert_eq!(deserialized.workflow_type.as_deref(), Some("feature_build"));
    }

    #[test]
    fn test_workflow_feature_start_payload_minimal() {
        let json = serde_json::json!({"feature_id": 1});
        let p: WorkflowFeatureStartPayload = serde_json::from_value(json).unwrap();
        assert_eq!(p.feature_id, 1);
        assert!(p.project_id.is_none());
        assert!(p.title.is_none());
        assert!(p.workflow_type.is_none());
    }

    #[test]
    fn test_workflow_feature_start_payload_missing_feature_id() {
        let json = serde_json::json!({"project_id": 1});
        let result = serde_json::from_value::<WorkflowFeatureStartPayload>(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_workflow_feature_start_response_roundtrip() {
        let p = WorkflowFeatureStartResponse {
            feature_id: 10,
            workflow_type: "feature_build".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowFeatureStartResponse = serde_json::from_value(v).unwrap();
        assert_eq!(d.feature_id, 10);
        assert_eq!(d.workflow_type, "feature_build");
    }

    #[test]
    fn test_workflow_approval_payload_roundtrip() {
        let p = WorkflowApprovalPayload {
            feature_id: 5,
            request_id: Some("req-123".into()),
            approved: true,
            feedback: Some("Looks good".into()),
        };
        let json = serde_json::to_string(&p).unwrap();
        let d: WorkflowApprovalPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(d.feature_id, 5);
        assert!(d.approved);
        assert_eq!(d.feedback.as_deref(), Some("Looks good"));
    }

    #[test]
    fn test_workflow_approval_payload_no_feedback() {
        let json = serde_json::json!({
            "feature_id": 5,
            "request_id": "req-1",
            "approved": false
        });
        let p: WorkflowApprovalPayload = serde_json::from_value(json).unwrap();
        assert!(!p.approved);
        assert!(p.feedback.is_none());
    }

    #[test]
    fn test_workflow_skip_item_payload_roundtrip() {
        let p = WorkflowSkipItemPayload {
            feature_id: 1,
            item_id: 99,
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowSkipItemPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.feature_id, 1);
        assert_eq!(d.item_id, 99);
    }

    #[test]
    fn test_workflow_retry_item_payload_roundtrip() {
        let p = WorkflowRetryItemPayload {
            feature_id: 2,
            item_id: 50,
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowRetryItemPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.feature_id, 2);
        assert_eq!(d.item_id, 50);
    }

    #[test]
    fn test_workflow_continue_payload_roundtrip() {
        let p = WorkflowContinuePayload { feature_id: 7 };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowContinuePayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.feature_id, 7);
    }

    #[test]
    fn test_workflow_start_build_payload_roundtrip() {
        let p = WorkflowStartBuildPayload { feature_id: 3 };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowStartBuildPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.feature_id, 3);
    }

    #[test]
    fn test_workflow_populate_queue_payload_roundtrip() {
        let p = WorkflowPopulateQueuePayload {
            feature_id: 4,
            plan_id: Some(10),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowPopulateQueuePayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.feature_id, 4);
        assert_eq!(d.plan_id, Some(10));
    }

    #[test]
    fn test_workflow_populate_queue_payload_no_plan() {
        let json = serde_json::json!({"feature_id": 4});
        let p: WorkflowPopulateQueuePayload = serde_json::from_value(json).unwrap();
        assert!(p.plan_id.is_none());
    }

    #[test]
    fn test_workflow_permission_respond_payload_roundtrip() {
        let p = WorkflowPermissionRespondPayload {
            feature_id: 1,
            agent_slot: AgentSlot::QueueItem(5),
            request_id: "r1".into(),
            decision: PermissionDecision::AllowFuture,
            option_id: Some("native-option".into()),
            feedback: Some("ok".into()),
            updated_input: Some(serde_json::json!({"key": "val"})),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowPermissionRespondPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.decision, PermissionDecision::AllowFuture);
        assert_eq!(d.option_id.as_deref(), Some("native-option"));
        assert_eq!(d.agent_slot, AgentSlot::QueueItem(5));
        assert_eq!(d.updated_input.unwrap()["key"], "val");
    }

    #[test]
    fn test_workflow_prompt_send_payload_roundtrip() {
        let p = WorkflowPromptSendPayload {
            feature_id: 1,
            agent_slot: AgentSlot::QueueItem(2),
            text: "hello agent".into(),
            images: Some(vec![ImagePayload {
                base64: "base64data".into(),
                mime_type: "image/png".into(),
            }]),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowPromptSendPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.text, "hello agent");
        assert_eq!(d.images.unwrap().len(), 1);
    }

    #[test]
    fn test_workflow_set_autonomy_payload_roundtrip() {
        let p = WorkflowSetAutonomyPayload {
            feature_id: 1,
            level: 3,
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowSetAutonomyPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.level, 3);
    }

    #[test]
    fn test_workflow_set_parallel_payload_roundtrip() {
        let p = WorkflowSetParallelPayload {
            feature_id: 1,
            enabled: false,
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowSetParallelPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.feature_id, 1);
        assert!(!d.enabled);
    }

    #[test]
    fn test_workflow_interrupt_payload_roundtrip() {
        let p = WorkflowInterruptPayload {
            feature_id: 1,
            agent_slot: AgentSlot::QueueItem(42),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowInterruptPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.agent_slot, AgentSlot::QueueItem(42));
    }

    #[test]
    fn test_workflow_start_session_payload_roundtrip() {
        let p = WorkflowStartSessionPayload {
            feature_id: 1,
            prompt: "fix the bug".into(),
            images: None,
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowStartSessionPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.prompt, "fix the bug");
        assert!(d.images.is_none());
    }

    #[test]
    fn test_workflow_start_refine_payload_roundtrip() {
        let p = WorkflowStartRefinePayload {
            feature_id: 1,
            description: "refine the plan".into(),
            images: Some(vec![]),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowStartRefinePayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.description, "refine the plan");
    }

    #[test]
    fn test_workflow_start_review_fixer_payload_roundtrip() {
        let p = WorkflowStartReviewFixerPayload {
            feature_id: 1,
            comments: "fix lint errors".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowStartReviewFixerPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.comments, "fix lint errors");
    }

    #[test]
    fn test_workflow_start_risk_payload_roundtrip() {
        let p = WorkflowStartRiskPayload { feature_id: 42 };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowStartRiskPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.feature_id, 42);
    }

    #[test]
    fn test_workflow_start_retro_payload_roundtrip() {
        let p = WorkflowStartRetroPayload { feature_id: 99 };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowStartRetroPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.feature_id, 99);
    }

    #[test]
    fn test_workflow_mark_done_payload_roundtrip() {
        let p = WorkflowMarkDonePayload {
            feature_id: 1,
            agent_slot: AgentSlot::QueueItem(10),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowMarkDonePayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.agent_slot, AgentSlot::QueueItem(10));
    }

    #[test]
    fn test_workflow_start_prd_payload_roundtrip() {
        let p = WorkflowStartPrdPayload {
            feature_id: 3,
            description: "build a dashboard".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowStartPrdPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.feature_id, 3);
        assert_eq!(d.description, "build a dashboard");
    }

    // --- Server → Client workflow event payloads ---

    #[test]
    fn test_workflow_agent_started_payload_roundtrip() {
        let p = WorkflowAgentStartedPayload {
            feature_id: 1,
            agent_slot: AgentSlot::QueueItem(2),
            session_id: 100,
            agent_type: "execute".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowAgentStartedPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.session_id, 100);
        assert_eq!(d.agent_type, "execute");
    }

    #[test]
    fn test_workflow_item_completed_payload_roundtrip() {
        let p = WorkflowItemCompletedPayload {
            feature_id: 1,
            agent_slot: AgentSlot::QueueItem(3),
            result: Some("success".into()),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowItemCompletedPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.result.as_deref(), Some("success"));
    }

    #[test]
    fn test_workflow_item_error_payload_roundtrip() {
        let p = WorkflowItemErrorPayload {
            feature_id: 1,
            agent_slot: AgentSlot::QueueItem(4),
            error: "timeout".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowItemErrorPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.error, "timeout");
    }

    #[test]
    fn test_workflow_interrupted_payload_roundtrip() {
        let p = WorkflowInterruptedPayload {
            feature_id: 1,
            agent_slot: AgentSlot::QueueItem(5),
            status: "interrupted".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowInterruptedPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.status, "interrupted");
    }

    #[test]
    fn test_workflow_autonomy_updated_payload_roundtrip() {
        let p = WorkflowAutonomyUpdatedPayload {
            feature_id: 1,
            level: 5,
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowAutonomyUpdatedPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.level, 5);
    }

    #[test]
    fn test_workflow_queue_populated_payload_roundtrip() {
        let p = WorkflowQueuePopulatedPayload {
            feature_id: 1,
            item_count: 12,
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowQueuePopulatedPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.item_count, 12);
    }

    #[test]
    fn test_workflow_acknowledged_payload_roundtrip() {
        let p = WorkflowAcknowledgedPayload {
            feature_id: 1,
            action: "mark_done".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowAcknowledgedPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.action, "mark_done");
    }

    #[test]
    fn test_workflow_approval_resolved_payload_roundtrip() {
        let p = WorkflowApprovalResolvedPayload {
            feature_id: 1,
            approved: false,
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowApprovalResolvedPayload = serde_json::from_value(v).unwrap();
        assert!(!d.approved);
    }

    #[test]
    fn test_workflow_agent_stream_blocks_payload_roundtrip() {
        let p = WorkflowAgentStreamBlocksPayload {
            agent_slot: AgentSlot::QueueItem(1),
            session_id: 2,
            blocks: vec![serde_json::json!({"type": "text", "content": "hello"})],
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowAgentStreamBlocksPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.blocks.len(), 1);
    }

    #[test]
    fn test_workflow_agent_stream_error_payload_roundtrip() {
        let p = WorkflowAgentStreamErrorPayload {
            agent_slot: AgentSlot::QueueItem(1),
            session_id: 2,
            msg_type: "error".into(),
            error: "bad things".into(),
        };
        let json = serde_json::to_value(&p).unwrap();
        // Verify "type" rename
        assert_eq!(json["type"], "error");
        assert!(json.get("msg_type").is_none());
        let d: WorkflowAgentStreamErrorPayload = serde_json::from_value(json).unwrap();
        assert_eq!(d.msg_type, "error");
        assert_eq!(d.error, "bad things");
    }

    #[test]
    fn test_workflow_agent_stream_result_payload_type_rename() {
        let p = WorkflowAgentStreamResultPayload {
            agent_slot: AgentSlot::QueueItem(1),
            session_id: 2,
            msg_type: "result".into(),
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["type"], "result");
        assert!(json.get("msg_type").is_none());
    }

    #[test]
    fn test_workflow_permission_request_payload_roundtrip() {
        let p = WorkflowPermissionRequestPayload {
            feature_id: 1,
            agent_slot: AgentSlot::QueueItem(2),
            request_id: "perm-1".into(),
            tool_name: "Bash".into(),
            tool_input: serde_json::json!({"command": "ls"}),
            description: Some("list files".into()),
            pattern: Some("Bash(ls:*)".into()),
            preview: Some("ls".into()),
            options: vec![PermissionOptionPayload {
                decision: PermissionDecision::AllowFuture,
                option_id: None,
                label: "Allow future requests".into(),
                description: "Apply the provider's suggested permission update".into(),
                collect_feedback: false,
            }],
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowPermissionRequestPayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.tool_name, "Bash");
        assert_eq!(d.pattern.as_deref(), Some("Bash(ls:*)"));
        assert_eq!(d.preview.as_deref(), Some("ls"));
    }

    #[test]
    fn test_workflow_item_update_payload_roundtrip() {
        let p = WorkflowItemUpdatePayload {
            feature_id: 1,
            id: 5,
            status: "completed".into(),
            started_at: Some("2026-01-01T00:00:00Z".into()),
            ended_at: Some("2026-01-01T00:01:00Z".into()),
            result: Some("ok".into()),
            agent_session_id: Some(42),
        };
        let v = serde_json::to_value(&p).unwrap();
        let d: WorkflowItemUpdatePayload = serde_json::from_value(v).unwrap();
        assert_eq!(d.status, "completed");
        assert_eq!(d.agent_session_id, Some(42));
    }

    // --- PermissionDecision serialization ---

    #[test]
    fn test_permission_decision_serialization() {
        assert_eq!(
            serde_json::to_value(&PermissionDecision::AllowOnce).unwrap(),
            "allow_once"
        );
        assert_eq!(
            serde_json::to_value(&PermissionDecision::AllowFuture).unwrap(),
            "allow_future"
        );
        assert_eq!(
            serde_json::to_value(&PermissionDecision::Deny).unwrap(),
            "deny"
        );
    }

    #[test]
    fn test_permission_decision_deserialization() {
        let d: PermissionDecision =
            serde_json::from_value(serde_json::json!("allow_once")).unwrap();
        assert_eq!(d, PermissionDecision::AllowOnce);
        let d: PermissionDecision = serde_json::from_value(serde_json::json!("deny")).unwrap();
        assert_eq!(d, PermissionDecision::Deny);
    }

    #[test]
    fn test_permission_decision_invalid_variant() {
        let result = serde_json::from_value::<PermissionDecision>(serde_json::json!("invalid"));
        assert!(result.is_err());
    }

    // --- HasFeatureId trait ---

    #[test]
    fn test_has_feature_id_trait() {
        let p = WorkflowSkipItemPayload {
            feature_id: 42,
            item_id: 1,
        };
        assert_eq!(p.feature_id(), 42);

        let p = WorkflowContinuePayload { feature_id: 99 };
        assert_eq!(p.feature_id(), 99);

        let p = WorkflowInterruptPayload {
            feature_id: 7,
            agent_slot: AgentSlot::QueueItem(3),
        };
        assert_eq!(p.feature_id(), 7);
    }

    // --- Envelope with workflow payloads ---

    #[test]
    fn test_envelope_with_workflow_payload_full_roundtrip() {
        let payload = WorkflowSkipItemPayload {
            feature_id: 1,
            item_id: 5,
        };
        let env = WsEnvelope::new(
            "workflow",
            "skip_item",
            serde_json::to_value(&payload).unwrap(),
        );
        let json_str: String = env.into();
        let parsed = WsEnvelope::try_from(json_str).unwrap();
        assert_eq!(parsed.domain, "workflow");
        assert_eq!(parsed.action, "skip_item");
        let inner: WorkflowSkipItemPayload = serde_json::from_value(parsed.payload).unwrap();
        assert_eq!(inner.item_id, 5);
    }

    #[test]
    fn commands_get_payload_requires_provider() {
        let error =
            serde_json::from_value::<CommandsGetPayload>(serde_json::json!({"cwd": "/tmp"}))
                .expect_err("provider should be required");

        assert!(error.to_string().contains("provider"));
    }

    #[test]
    fn test_reply_envelope_with_workflow_error() {
        let error = SessionErrorPayload {
            code: "NO_ENGINE".into(),
            message: "No engine".into(),
        };
        let reply = WsEnvelope::reply(
            "orig-id",
            "workflow",
            "error",
            serde_json::to_value(&error).unwrap(),
        );
        assert_eq!(reply.r#ref.as_deref(), Some("orig-id"));
        assert_eq!(reply.domain, "workflow");
        assert_eq!(reply.action, "error");
        let parsed: SessionErrorPayload = serde_json::from_value(reply.payload).unwrap();
        assert_eq!(parsed.code, "NO_ENGINE");
    }

    #[test]
    fn test_envelope_requires_id_field() {
        // Envelopes missing the `id` field must fail deserialization
        let json = serde_json::json!({
            "domain": "workflow",
            "action": "start_plan",
            "payload": { "feature_id": 1, "description": "test" }
        })
        .to_string();
        let result = WsEnvelope::try_from(json);
        assert!(result.is_err());
        let err = format!("{}", result.unwrap_err());
        assert!(
            err.contains("id"),
            "error should mention missing id field: {err}"
        );
    }
}
