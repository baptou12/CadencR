use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::agents::adapter::{RuntimePermissionDecision, RuntimePermissionOption};

/// Permission decision from the client.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    AllowOnce,
    AllowFuture,
    Deny,
}

impl PermissionDecision {
    pub fn to_runtime_decision(&self, option_id: Option<&str>) -> RuntimePermissionDecision {
        match self {
            Self::AllowOnce => RuntimePermissionDecision::AllowOnce,
            Self::AllowFuture if is_allow_for_session_option(option_id) => {
                RuntimePermissionDecision::AllowForSession
            }
            Self::AllowFuture => RuntimePermissionDecision::AllowFuture,
            Self::Deny => RuntimePermissionDecision::Deny,
        }
    }
}

fn is_allow_for_session_option(option_id: Option<&str>) -> bool {
    matches!(option_id, Some("allow_for_session" | "session"))
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
                // The WS protocol predates the runtime split between
                // session-scoped and persistent grants and only exposes a
                // single `AllowFuture` discriminant; both runtime flavours
                // collapse onto it for backwards compatibility. Distinct
                // labels/descriptions still let the FE render two separate
                // buttons when the agent advertises both kinds.
                RuntimePermissionDecision::AllowFuture
                | RuntimePermissionDecision::AllowForSession => PermissionDecision::AllowFuture,
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

/// Discriminant for `SessionLifecyclePayload`.
///
/// Currently only carries OS-power-driven transitions. `SuspendRequested` is
/// emitted after the WS handler has captured the runtime session id and
/// interrupted the live process in response to a `session.suspend` envelope
/// (driven by Electron's `powerMonitor.suspend`); `Resumed` is the matching
/// acknowledgement after `session.resume`. The frontend turn-lifecycle state
/// machine consumes these via `ws-envelope-handler` — UI never flips on the
/// raw OS event, only on this backend-confirmed envelope (see
/// `no-optimistic-updates.md`).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionLifecycleKind {
    SuspendRequested,
    Resumed,
}

/// Server → Client: a lifecycle transition driven outside the normal turn
/// flow (today: OS suspend/resume). Provider-neutral — every adapter emits
/// the same shape and the frontend renders the same banner regardless of
/// which provider is active.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionLifecyclePayload {
    pub session_id: String,
    pub kind: SessionLifecycleKind,
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
    /// `true` when the server is currently re-resolving the catalog in
    /// the background (the FE returned cached data instantly; a fresh
    /// `commands.updated` envelope will follow when the probe
    /// completes). The FE renders a small spinner / loader while this
    /// is set so the user knows the picker is being refreshed.
    #[serde(default)]
    pub refreshing: bool,
}

/// Server → Client: live slash-command catalog the agent advertised
/// over the runtime stream (today: ACP `available_commands_update`).
///
/// Emitted whenever a `RuntimeEventKind::SlashCommandsUpdated` arrives
/// on a session's runtime channel. The full catalog is sent every time
/// — frontends should replace, not merge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandsUpdatedPayload {
    pub commands: Vec<SlashCommandPayload>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_decision_to_runtime_maps_allow_once_and_deny() {
        assert_eq!(
            PermissionDecision::AllowOnce.to_runtime_decision(None),
            RuntimePermissionDecision::AllowOnce
        );
        assert_eq!(
            PermissionDecision::Deny.to_runtime_decision(Some("deny")),
            RuntimePermissionDecision::Deny
        );
    }

    #[test]
    fn permission_decision_to_runtime_maps_allow_future_variants_by_option_id() {
        assert_eq!(
            PermissionDecision::AllowFuture.to_runtime_decision(Some("allow_for_session")),
            RuntimePermissionDecision::AllowForSession
        );
        assert_eq!(
            PermissionDecision::AllowFuture.to_runtime_decision(Some("session")),
            RuntimePermissionDecision::AllowForSession
        );
        assert_eq!(
            PermissionDecision::AllowFuture.to_runtime_decision(Some("allow_always")),
            RuntimePermissionDecision::AllowFuture
        );
    }

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

    #[test]
    fn commands_get_payload_requires_provider() {
        let error =
            serde_json::from_value::<CommandsGetPayload>(serde_json::json!({"cwd": "/tmp"}))
                .expect_err("provider should be required");

        assert!(error.to_string().contains("provider"));
    }

    #[test]
    fn test_envelope_requires_id_field() {
        // Envelopes missing the `id` field must fail deserialization
        let json = serde_json::json!({
            "domain": "session",
            "action": "init",
            "payload": { "feature_id": 1 }
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
