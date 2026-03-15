use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptSendPayload {
    pub session_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRespondPayload {
    pub session_id: String,
    pub request_id: String,
    pub granted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionActionPayload {
    pub session_id: String,
}

// --- Server → Client payloads ---

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
        let p = SessionInitPayload { model: Some("opus".into()), permission_mode: None, system_prompt: None, cwd: Some("/tmp".into()) };
        let v = serde_json::to_value(&p).unwrap();
        let _: SessionInitPayload = serde_json::from_value(v).unwrap();

        // PromptSendPayload
        let p = PromptSendPayload { session_id: "s1".into(), text: "hello".into() };
        let v = serde_json::to_value(&p).unwrap();
        let _: PromptSendPayload = serde_json::from_value(v).unwrap();

        // PermissionRespondPayload
        let p = PermissionRespondPayload { session_id: "s1".into(), request_id: "r1".into(), granted: true };
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
        let p = PermissionRequestPayload { request_id: "r1".into(), tool_name: "bash".into(), tool_input: serde_json::json!({}), description: Some("run cmd".into()) };
        let v = serde_json::to_value(&p).unwrap();
        let _: PermissionRequestPayload = serde_json::from_value(v).unwrap();

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
