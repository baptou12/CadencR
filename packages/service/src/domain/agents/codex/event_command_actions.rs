use serde_json::{json, Value};

use super::event_items::stream_start_event;
use super::event_json::thread_id;
use super::event_state::IndexState;
use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeEvent};

pub(super) fn command_action_events(
    params: &Value,
    completed: bool,
    index_state: &mut IndexState,
) -> Vec<RuntimeEvent> {
    let Some(item) = params.get("item") else {
        return Vec::new();
    };
    if !is_exploring_command_item(item) {
        return Vec::new();
    }
    let Some(actions) = command_actions(item) else {
        return Vec::new();
    };
    let item_id = item
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("codex_item");
    actions
        .iter()
        .enumerate()
        .filter_map(|(index, action)| command_action_tool_use(action, item_id, index))
        .filter_map(|tool| command_action_event(params, tool, completed, index_state))
        .collect()
}

pub(super) fn has_exploring_command_actions(params: &Value) -> bool {
    params.get("item").is_some_and(is_exploring_command_item)
}

fn is_exploring_command_item(item: &Value) -> bool {
    !is_user_shell_command(item)
        && command_actions(item).is_some_and(|actions| {
            !actions.is_empty()
                && actions.iter().enumerate().all(|(index, action)| {
                    command_action_tool_use(action, "codex_item", index).is_some()
                })
        })
}

fn is_user_shell_command(item: &Value) -> bool {
    matches!(
        item.get("source").and_then(Value::as_str),
        Some("userShell")
    )
}

fn command_actions(item: &Value) -> Option<&Vec<Value>> {
    item.get("commandActions")
        .or_else(|| item.get("command_actions"))
        .and_then(Value::as_array)
}

struct CommandActionToolUse {
    id: String,
    name: String,
    input: Value,
}

fn command_action_event(
    params: &Value,
    tool: CommandActionToolUse,
    completed: bool,
    index_state: &mut IndexState,
) -> Option<RuntimeEvent> {
    if completed && index_state.has_index(&tool.id) {
        return None;
    }
    if !completed && index_state.has_index(&tool.id) {
        return None;
    }
    let block = RuntimeContentBlock::ToolUse {
        id: tool.id.clone(),
        name: tool.name,
        input: tool.input,
    };
    Some(stream_start_event(
        thread_id(params),
        index_state.index_for(&tool.id),
        block,
    ))
}

fn command_action_tool_use(
    action: &Value,
    item_id: &str,
    index: usize,
) -> Option<CommandActionToolUse> {
    let name = command_action_tool_name(action)?;
    let input = command_action_input(&name, action)?;
    Some(CommandActionToolUse {
        id: format!("{item_id}:command_action:{index}"),
        name,
        input,
    })
}

fn command_action_tool_name(action: &Value) -> Option<String> {
    match action_kind(action)? {
        "read" => Some("Read".to_string()),
        "list" | "listFiles" | "ls" => Some("LS".to_string()),
        "glob" => Some("Glob".to_string()),
        "search" | "grep" => Some("Grep".to_string()),
        _ => None,
    }
}

fn command_action_input(tool_name: &str, action: &Value) -> Option<Value> {
    let mut input = full_action_input(action);
    match tool_name {
        "Read" => {
            input
                .entry("file_path".to_string())
                .or_insert(json!(action_target(action)?));
            Some(Value::Object(input))
        }
        "LS" => {
            input
                .entry("path".to_string())
                .or_insert(json!(action_target(action)?));
            Some(Value::Object(input))
        }
        "Glob" => {
            input
                .entry("path".to_string())
                .or_insert(json!(action_target(action)?));
            input
                .entry("pattern".to_string())
                .or_insert(json!(
                    action_string(action, &["pattern", "glob"]).unwrap_or("*")
                ));
            Some(Value::Object(input))
        }
        "Grep" => {
            input
                .entry("pattern".to_string())
                .or_insert(json!(action_string(action, &["pattern", "query", "regex"])
                    .or_else(|| action_target(action))?));
            if let Some(path) = action_string(action, &["path", "directory", "dir"]) {
                input.entry("path".to_string()).or_insert(json!(path));
            }
            Some(Value::Object(input))
        }
        _ => None,
    }
}

fn full_action_input(action: &Value) -> serde_json::Map<String, Value> {
    match action.as_object() {
        Some(object) => object.clone(),
        None => serde_json::Map::from_iter([("value".to_string(), action.clone())]),
    }
}

fn action_kind(action: &Value) -> Option<&str> {
    if let Some(value) = action.as_str() {
        return Some(value);
    }
    action_string(action, &["type", "action", "kind", "name"])
}

fn action_target(action: &Value) -> Option<&str> {
    action_string(
        action,
        &[
            "path",
            "file_path",
            "filePath",
            "directory",
            "dir",
            "query",
            "pattern",
        ],
    )
}

fn action_string<'a>(action: &'a Value, keys: &[&str]) -> Option<&'a str> {
    let object = action.as_object()?;
    keys.iter().find_map(|key| object.get(*key)?.as_str())
}

#[cfg(test)]
mod tests {
    use super::{command_action_events, has_exploring_command_actions};
    use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeStreamEvent};
    use crate::domain::agents::codex::event_state::IndexState;
    use crate::domain::agents::codex::events::notification_events;
    use serde_json::{json, Value};

    fn tool_names(events: &[crate::domain::agents::adapter::RuntimeEvent]) -> Vec<String> {
        events
            .iter()
            .filter_map(|event| match event.stream_event()? {
                RuntimeStreamEvent::ContentBlockStart {
                    block: RuntimeContentBlock::ToolUse { name, .. },
                    ..
                } => Some(name.clone()),
                _ => None,
            })
            .collect()
    }

    fn first_tool_input(events: &[crate::domain::agents::adapter::RuntimeEvent]) -> Value {
        events
            .iter()
            .find_map(|event| match event.stream_event()? {
                RuntimeStreamEvent::ContentBlockStart {
                    block: RuntimeContentBlock::ToolUse { input, .. },
                    ..
                } => Some(input.clone()),
                _ => None,
            })
            .expect("expected tool input")
    }

    #[test]
    fn command_actions_emit_classic_tool_calls() {
        let params = json!({
            "threadId": "thread",
            "item": {
                "type": "commandExecution",
                "id": "cmd",
                "commandActions": [
                    { "type": "read", "path": "/etc/hosts" },
                    { "type": "list", "path": "packages/service" },
                    { "type": "search", "query": "RuntimeEvent", "path": "packages/service" }
                ]
            }
        });
        let mut indexes = IndexState::default();

        assert!(has_exploring_command_actions(&params));
        let events = command_action_events(&params, false, &mut indexes);

        assert_eq!(tool_names(&events), vec!["Read", "LS", "Grep"]);
        let input = first_tool_input(&events);
        assert_eq!(input["type"], "read");
        assert_eq!(input["path"], "/etc/hosts");
        assert_eq!(input["file_path"], "/etc/hosts");
    }

    #[test]
    fn non_exploring_command_actions_do_not_emit_virtual_tools() {
        let mut indexes = IndexState::default();
        let params = json!({
            "threadId": "thread",
            "item": {
                "type": "commandExecution",
                "id": "cmd",
                "source": "agent",
                "command": "cat package.json && pnpm test",
                "commandActions": [
                    { "type": "read", "path": "package.json" },
                    { "type": "unknown", "command": "pnpm test" }
                ]
            }
        });

        assert!(!has_exploring_command_actions(&params));
        assert!(command_action_events(&params, false, &mut indexes).is_empty());
        let events = notification_events("item/completed", params, None, &mut indexes);
        assert_eq!(tool_names(&events), vec!["Bash"]);
    }

    #[test]
    fn user_shell_command_actions_do_not_emit_virtual_tools() {
        let mut indexes = IndexState::default();
        let params = json!({
            "threadId": "thread",
            "item": {
                "type": "commandExecution",
                "id": "cmd",
                "source": "userShell",
                "commandActions": [{ "type": "read", "path": "/etc/hosts" }]
            }
        });

        assert!(!has_exploring_command_actions(&params));
        assert!(command_action_events(&params, false, &mut indexes).is_empty());
    }

    #[test]
    fn completed_command_actions_do_not_duplicate_started_actions() {
        let params = json!({
            "threadId": "thread",
            "item": {
                "type": "commandExecution",
                "id": "cmd",
                "commandActions": [{ "type": "read", "path": "README.md" }]
            }
        });
        let mut indexes = IndexState::default();

        assert_eq!(command_action_events(&params, false, &mut indexes).len(), 1);
        assert!(command_action_events(&params, true, &mut indexes).is_empty());
    }

    #[test]
    fn command_waits_for_completed_command_actions() {
        let mut indexes = IndexState::default();
        let started = notification_events(
            "item/started",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "commandExecution",
                    "id": "cmd",
                    "command": "/bin/zsh -lc 'cat /etc/hosts'"
                }
            }),
            None,
            &mut indexes,
        );
        let completed = notification_events(
            "item/completed",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "commandExecution",
                    "id": "cmd",
                    "command": "/bin/zsh -lc 'cat /etc/hosts'",
                    "commandActions": [{ "type": "read", "path": "/etc/hosts" }]
                }
            }),
            None,
            &mut indexes,
        );

        assert!(started.is_empty());
        assert_eq!(tool_names(&completed), vec!["Read"]);
    }

    #[test]
    fn unstreamed_command_without_actions_emits_bash_on_completion() {
        let mut indexes = IndexState::default();
        let started = notification_events(
            "item/started",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "commandExecution",
                    "id": "cmd",
                    "command": "/bin/zsh -lc 'cat /etc/hosts'"
                }
            }),
            None,
            &mut indexes,
        );
        let completed = notification_events(
            "item/completed",
            json!({
                "threadId": "thread",
                "item": {
                    "type": "commandExecution",
                    "id": "cmd",
                    "command": "/bin/zsh -lc 'cat /etc/hosts'",
                    "aggregatedOutput": "127.0.0.1 localhost",
                    "status": "completed"
                }
            }),
            None,
            &mut indexes,
        );

        assert!(started.is_empty());
        assert_eq!(tool_names(&completed), vec!["Bash"]);
        assert_eq!(completed.len(), 2);
    }
}
