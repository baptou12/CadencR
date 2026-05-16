//! Permission-related wire shapes for OpenCode's embedded HTTP backend.
//!
//! Backs `OpenCodeClient::list_permissions` / `reply_permission`. The
//! corresponding REST endpoints (`GET /permission`,
//! `POST /permission/{id}/reply`) exist on every `opencode acp` subprocess
//! we spawn and are the only way to surface and answer sub-agent
//! permission prompts that the ACP wire silently drops (upstream issue
//! sst/opencode#6573).

use serde_json::Value;

/// Reply choice for `POST /permission/{id}/reply`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionReply {
    /// Allow this single invocation only.
    Once,
    /// Allow and persist the rule for the rest of this session.
    Always,
    /// Reject — the tool call is aborted.
    Reject,
}

impl PermissionReply {
    pub(crate) fn wire(self) -> &'static str {
        match self {
            Self::Once => "once",
            Self::Always => "always",
            Self::Reject => "reject",
        }
    }
}

/// One pending permission prompt returned by `GET /permission`.
///
/// Shape matches what `opencode acp` exposes on its embedded HTTP backend
/// (see `opencode/src/permission/index.ts` upstream):
/// `{ id, sessionID, permission, patterns, metadata, always, tool:
/// { messageID, callID } }`. We model the fields the listener uses to
/// render the prompt; `always` stays opaque.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingPermission {
    pub id: String,
    pub session_id: String,
    /// Tool kind from upstream (`bash`, `edit`, `webfetch`, …). Not yet
    /// normalised — the listener maps it through the same name helpers
    /// the rest of the OpenCode adapter uses.
    pub tool: Option<String>,
    pub title: Option<String>,
    /// `tool.callID` from upstream — the parent tool_use id.
    pub call_id: Option<String>,
    /// `tool.messageID` from upstream.
    pub message_id: Option<String>,
    /// Upstream's `patterns: string[]`. Load-bearing: shell-style tools
    /// (e.g. `bash`) leave `metadata` empty and put the actual command
    /// here, so any preview that only consults `metadata` would render a
    /// blank prompt. The listener merges this into the synthesized
    /// `tool_input` alongside `metadata`.
    pub patterns: Vec<String>,
    /// Raw `metadata` payload. Upstream tools nest their user-visible
    /// inputs here when applicable (`edit`: `{filepath, diff}`, …);
    /// shell tools send `{}` and rely on `patterns` instead.
    pub metadata: Value,
}

pub(crate) fn parse_pending_permission(value: &Value) -> Option<PendingPermission> {
    let id = value.get("id").and_then(Value::as_str)?.to_string();
    let session_id = value.get("sessionID").and_then(Value::as_str)?.to_string();
    let tool = value
        .get("permission")
        .or_else(|| value.get("type"))
        .or_else(|| value.get("tool").and_then(|t| t.get("name")))
        .and_then(Value::as_str)
        .map(str::to_string);
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_string);
    let tool_obj = value.get("tool");
    let call_id = tool_obj
        .and_then(|t| t.get("callID"))
        .or_else(|| value.get("callID"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let message_id = tool_obj
        .and_then(|t| t.get("messageID"))
        .or_else(|| value.get("messageID"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let patterns = value
        .get("patterns")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let metadata = value.get("metadata").cloned().unwrap_or(Value::Null);
    Some(PendingPermission {
        id,
        session_id,
        tool,
        title,
        call_id,
        message_id,
        patterns,
        metadata,
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_pending_permission, PermissionReply};
    use serde_json::json;

    #[test]
    fn parse_pending_permission_extracts_canonical_fields() {
        let parsed = parse_pending_permission(&json!({
            "id": "per_1",
            "sessionID": "ses_child",
            "permission": "bash",
            "metadata": {},
            "patterns": ["git status"],
            "always": [],
            "tool": { "messageID": "msg_1", "callID": "call_1" }
        }))
        .expect("expected pending permission");
        assert_eq!(parsed.id, "per_1");
        assert_eq!(parsed.session_id, "ses_child");
        assert_eq!(parsed.tool.as_deref(), Some("bash"));
        assert_eq!(parsed.call_id.as_deref(), Some("call_1"));
        assert_eq!(parsed.message_id.as_deref(), Some("msg_1"));
        // bash leaves metadata empty and puts the command in patterns —
        // the listener depends on `patterns` to render the prompt preview.
        assert_eq!(parsed.patterns, vec!["git status".to_string()]);
    }

    #[test]
    fn parse_pending_permission_defaults_patterns_to_empty_when_absent() {
        let parsed = parse_pending_permission(&json!({
            "id": "per_1", "sessionID": "ses", "metadata": {}
        }))
        .expect("expected pending permission");
        assert!(parsed.patterns.is_empty());
    }

    #[test]
    fn parse_pending_permission_requires_id_and_session_id() {
        assert!(parse_pending_permission(&json!({ "sessionID": "x" })).is_none());
        assert!(parse_pending_permission(&json!({ "id": "x" })).is_none());
    }

    #[test]
    fn permission_reply_wire_values_match_opencode() {
        assert_eq!(PermissionReply::Once.wire(), "once");
        assert_eq!(PermissionReply::Always.wire(), "always");
        assert_eq!(PermissionReply::Reject.wire(), "reject");
    }
}
