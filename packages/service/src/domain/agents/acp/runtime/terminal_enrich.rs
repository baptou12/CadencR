//! Pre-process ACP `session/update` payloads that reference a terminal so
//! the FE's BashBlock has both a command and the captured output.
//!
//! ACP splits Bash into two surfaces: a `terminal/create` server request
//! (which carries `command + args`) and a `tool_call` / `tool_call_update`
//! whose `content[]` contains a `{type: "terminal", terminalId}` reference.
//! Without enrichment, by the time the tool block reaches the FE it has an
//! empty `toolInput` and an opaque terminal ref — BashBlock renders blank.
//!
//! We resolve `terminalId → (command, output)` from the per-session
//! `TerminalRegistry`, inject `command` into `rawInput` (the spec field)
//! and `toolInput` (legacy non-spec field, kept for back-compat) when
//! missing, and replace the terminal entry in `content[]` with a
//! `{type: "text", text: <output>}` block so `flatten_tool_result_content`
//! collapses it into a string the BashBlock result path consumes directly.

use std::sync::Arc;

use serde_json::{json, Value};

use super::terminal_registry::TerminalRegistry;

/// Walk a `session/update` payload and rewrite any terminal references it
/// contains. Returns `Some(enriched)` only when at least one substitution
/// occurred — callers fall back to the original `params` otherwise so we
/// never pay a clone for non-terminal updates.
pub async fn enrich_session_update(
    params: &Value,
    terminals: &Arc<TerminalRegistry>,
) -> Option<Value> {
    let terminal_ids = collect_terminal_ids(params);
    if terminal_ids.is_empty() {
        return None;
    }

    let mut enriched = params.clone();
    let body = if enriched.get("update").is_some() {
        enriched.get_mut("update")?.as_object_mut()?
    } else {
        enriched.as_object_mut()?
    };

    for terminal_id in &terminal_ids {
        let command = terminals.command_for(terminal_id).await;
        let output = terminals.output_text(terminal_id).await;
        inject_command_into_input(body, command.as_deref());
        replace_terminal_in_content(body, terminal_id, output.as_deref());
    }
    Some(enriched)
}

fn collect_terminal_ids(params: &Value) -> Vec<String> {
    let body = params.get("update").unwrap_or(params);
    let Some(content) = body.get("content").and_then(Value::as_array) else {
        return Vec::new();
    };
    content
        .iter()
        .filter_map(|entry| {
            if entry.get("type").and_then(Value::as_str) != Some("terminal") {
                return None;
            }
            entry
                .get("terminalId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .collect()
}

fn inject_command_into_input(body: &mut serde_json::Map<String, Value>, command: Option<&str>) {
    let Some(command) = command else { return };
    // Write to both envelopes: `rawInput` is the spec-canonical field the
    // FE-bound start/update mappers prefer; `toolInput` is the legacy
    // non-spec field kept for back-compat with adapters that still read
    // it. The per-field guard keeps existing values untouched.
    for envelope in ["rawInput", "toolInput"] {
        let entry = body
            .entry(envelope)
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        let Some(map) = entry.as_object_mut() else {
            continue;
        };
        if map.contains_key("command") {
            continue;
        }
        map.insert("command".to_string(), Value::String(command.to_string()));
    }
}

fn replace_terminal_in_content(
    body: &mut serde_json::Map<String, Value>,
    terminal_id: &str,
    output: Option<&str>,
) {
    let Some(content) = body.get_mut("content").and_then(Value::as_array_mut) else {
        return;
    };
    for entry in content.iter_mut() {
        let matches = entry.get("type").and_then(Value::as_str) == Some("terminal")
            && entry.get("terminalId").and_then(Value::as_str) == Some(terminal_id);
        if !matches {
            continue;
        }
        *entry = json!({
            "type": "text",
            "text": output.unwrap_or(""),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::enrich_session_update;
    use crate::domain::agents::acp::runtime::terminal_registry::TerminalRegistry;
    use serde_json::json;
    use std::sync::Arc;

    async fn registry_with_terminal() -> (Arc<TerminalRegistry>, String) {
        let registry = Arc::new(TerminalRegistry::default());
        let cwd = std::env::temp_dir();
        let result = registry
            .create(&json!({ "command": "echo", "args": ["hello"] }), &cwd)
            .await
            .expect("create ok");
        let id = result["terminalId"].as_str().unwrap().to_string();
        let _ = registry.wait_for_exit(&id).await.unwrap();
        (registry, id)
    }

    #[tokio::test]
    async fn enrich_returns_none_when_no_terminal_references() {
        let registry = Arc::new(TerminalRegistry::default());
        let params = json!({
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": "hi"
            }
        });
        assert!(enrich_session_update(&params, &registry).await.is_none());
    }

    #[tokio::test]
    async fn enrich_injects_command_into_empty_tool_input() {
        let (registry, id) = registry_with_terminal().await;
        let params = json!({
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "t-1",
                "toolName": "bash",
                "toolInput": {},
                "content": [{ "type": "terminal", "terminalId": id }]
            }
        });
        let enriched = enrich_session_update(&params, &registry).await.unwrap();
        assert_eq!(enriched["update"]["toolInput"]["command"], "echo hello");
        // Spec-canonical envelope is also populated.
        assert_eq!(enriched["update"]["rawInput"]["command"], "echo hello");
    }

    #[tokio::test]
    async fn enrich_injects_command_into_raw_input_when_missing() {
        // Mirrors the OpenCode wire shape: `rawInput: {}` (the agent puts
        // the command in `terminal/create`, not in the tool call). The
        // start mapper prefers `rawInput`, so the enriched envelope must
        // populate it for the FE BashBlock to render the command.
        let (registry, id) = registry_with_terminal().await;
        let params = json!({
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "t-1",
                "toolName": "bash",
                "rawInput": {},
                "content": [{ "type": "terminal", "terminalId": id }]
            }
        });
        let enriched = enrich_session_update(&params, &registry).await.unwrap();
        assert_eq!(enriched["update"]["rawInput"]["command"], "echo hello");
    }

    #[tokio::test]
    async fn enrich_replaces_terminal_entry_with_text_output() {
        let (registry, id) = registry_with_terminal().await;
        let params = json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "t-1",
                "status": "completed",
                "content": [{ "type": "terminal", "terminalId": id }]
            }
        });
        let enriched = enrich_session_update(&params, &registry).await.unwrap();
        let entry = &enriched["update"]["content"][0];
        assert_eq!(entry["type"], "text");
        let text = entry["text"].as_str().unwrap();
        assert!(text.contains("hello"), "output was: {text}");
    }

    #[tokio::test]
    async fn enrich_preserves_existing_command_arg() {
        let (registry, id) = registry_with_terminal().await;
        let params = json!({
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "t-1",
                "toolName": "bash",
                "toolInput": { "command": "user-set" },
                "rawInput": { "command": "user-raw" },
                "content": [{ "type": "terminal", "terminalId": id }]
            }
        });
        let enriched = enrich_session_update(&params, &registry).await.unwrap();
        assert_eq!(enriched["update"]["toolInput"]["command"], "user-set");
        assert_eq!(enriched["update"]["rawInput"]["command"], "user-raw");
    }

    #[tokio::test]
    async fn enrich_handles_unknown_terminal_id_gracefully() {
        let registry = Arc::new(TerminalRegistry::default());
        let params = json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "t-1",
                "status": "completed",
                "content": [{ "type": "terminal", "terminalId": "term_missing" }]
            }
        });
        let enriched = enrich_session_update(&params, &registry).await.unwrap();
        assert_eq!(enriched["update"]["content"][0]["type"], "text");
    }
}
