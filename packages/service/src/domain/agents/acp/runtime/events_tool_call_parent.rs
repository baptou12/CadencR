//! Parent-tool-use linkage extraction for sub-agent nesting.
//!
//! Split out of `events_tool_call.rs` to keep that file under the 400-line
//! ceiling (per `.claude/rules/file-size.md`). The function and its tests
//! cover the small but spec-relevant concern of mapping ACP's various
//! parent-id field names onto a single `parent_tool_use_id` the FE uses to
//! nest child events under the parent tool block.

use serde_json::Value;

/// Extract a parent-tool-use id for sub-agent linkage from a `tool_call` /
/// `tool_call_update` body. ACP today carries this on the parent-side
/// (`parentToolCallId` / `parentToolUseId`) and on the spawn-side
/// (`subAgentSessionId` — the child session id, used by the FE to nest
/// child events under the parent tool block). We accept all forms so an
/// adapter that only emits one of them still surfaces nesting metadata.
///
/// Note: ACP sub-agent **replay** (loading a child session's history on
/// restart) is a separate concern — it requires `session/load`, which is
/// gated on the agent advertising the `loadSession` capability. This is
/// out of scope until OpenCode supports durable sessions; the existing
/// skip-and-log path in `lifecycle.rs` covers the absence-of-capability
/// case.
pub(super) fn parent_tool_use_id(body: &Value) -> Option<String> {
    body.get("parentToolCallId")
        .or_else(|| body.get("parentToolUseId"))
        .or_else(|| body.get("parent_tool_use_id"))
        .or_else(|| body.get("subAgentSessionId"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::parent_tool_use_id;
    use serde_json::json;

    #[test]
    fn picks_parent_tool_call_id_first() {
        let body = json!({
            "parentToolCallId": "parent-1",
            "parentToolUseId": "ignored",
        });
        assert_eq!(parent_tool_use_id(&body).as_deref(), Some("parent-1"));
    }

    #[test]
    fn falls_back_to_parent_tool_use_id() {
        let body = json!({ "parentToolUseId": "parent-2" });
        assert_eq!(parent_tool_use_id(&body).as_deref(), Some("parent-2"));
    }

    #[test]
    fn falls_back_to_snake_case_parent_tool_use_id() {
        let body = json!({ "parent_tool_use_id": "parent-3" });
        assert_eq!(parent_tool_use_id(&body).as_deref(), Some("parent-3"));
    }

    #[test]
    fn falls_back_to_sub_agent_session_id() {
        let body = json!({ "subAgentSessionId": "sub-4" });
        assert_eq!(parent_tool_use_id(&body).as_deref(), Some("sub-4"));
    }

    #[test]
    fn returns_none_when_no_parent_field_present() {
        let body = json!({ "toolCallId": "t-1" });
        assert!(parent_tool_use_id(&body).is_none());
    }
}
