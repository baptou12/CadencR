//! Resolve ACP tool-call metadata into Cadencr's canonical tool names.
//!
//! ACP `title` is display text, not a stable tool identifier. Cursor uses
//! command previews such as `` `pnpm lint` `` for that field, while `kind`
//! carries the protocol-level `execute` classification.

use serde_json::Value;

use super::provider_hooks::AcpProviderHooks;

pub(super) fn resolve_tool_name(body: &Value, hooks: &dyn AcpProviderHooks) -> String {
    let hint = body
        .get("toolName")
        .and_then(Value::as_str)
        .or_else(|| tool_name_from_kind(body))
        .or_else(|| body.get("title").and_then(Value::as_str))
        .unwrap_or("tool");
    hooks.normalize_tool_name(hint)
}

fn tool_name_from_kind(body: &Value) -> Option<&'static str> {
    match body.get("kind").and_then(Value::as_str)? {
        "read" => Some("Read"),
        "edit" => Some("Edit"),
        "delete" => Some("Delete"),
        "move" => Some("Move"),
        "search" => Some("Search"),
        "execute" => Some("Bash"),
        "think" => Some("Think"),
        "fetch" => Some("Fetch"),
        "switch_mode" => Some("SwitchMode"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_tool_name;
    use crate::domain::agents::acp::runtime::provider_hooks::AcpProviderHooks;
    use crate::domain::agents::adapter::RuntimePermissionMode;
    use serde_json::{json, Value};

    struct IdentityHooks;

    #[async_trait::async_trait]
    impl AcpProviderHooks for IdentityHooks {
        fn normalize_tool_name(&self, raw: &str) -> String {
            raw.to_string()
        }

        fn normalize_tool_input(&self, _tool_name: &str, input: Value) -> Value {
            input
        }

        fn mode_for_permission_mode(&self, _mode: RuntimePermissionMode) -> Option<String> {
            None
        }
    }

    #[test]
    fn execute_kind_wins_over_human_readable_command_title() {
        let body = json!({ "title": "`pnpm lint`", "kind": "execute" });
        assert_eq!(resolve_tool_name(&body, &IdentityHooks), "Bash");
    }

    #[test]
    fn explicit_tool_name_wins_over_coarse_kind() {
        let body = json!({ "toolName": "CustomRunner", "title": "run", "kind": "execute" });
        assert_eq!(resolve_tool_name(&body, &IdentityHooks), "CustomRunner");
    }

    #[test]
    fn title_remains_the_fallback_when_kind_is_unknown() {
        let body = json!({ "title": "custom action", "kind": "other" });
        assert_eq!(resolve_tool_name(&body, &IdentityHooks), "custom action");
    }
}
