use serde::Deserialize;
use serde_json::Value;

pub(super) fn command_input(item: &Value) -> Value {
    let mut input = full_item_input(item);
    insert_alias(&mut input, item, "output", "aggregatedOutput");
    Value::Object(input)
}

pub(super) fn file_input(item: &Value) -> Value {
    let patch_text = patch_from_changes(item.get("changes"));
    let mut input = full_item_input(item);
    input.insert("patch_text".to_string(), patch_text.clone());
    input.insert("patch".to_string(), patch_text);
    Value::Object(input)
}

pub(super) fn mcp_input(item: &Value) -> Value {
    Value::Object(full_item_input(item))
}

pub(super) fn dynamic_tool_input(item: &Value) -> Value {
    let mut input = full_item_input(item);
    flatten_arguments(&mut input, item);
    Value::Object(input)
}

pub(super) fn collab_tool_input(item: &Value) -> Value {
    Value::Object(full_item_input(item))
}

fn full_item_input(item: &Value) -> serde_json::Map<String, Value> {
    item.as_object().cloned().unwrap_or_default()
}

fn insert_alias(
    input: &mut serde_json::Map<String, Value>,
    item: &Value,
    alias: &str,
    source: &str,
) {
    if input.contains_key(alias) {
        return;
    }
    if let Some(value) = item.get(source).cloned() {
        input.insert(alias.to_string(), value);
    }
}

fn flatten_arguments(input: &mut serde_json::Map<String, Value>, item: &Value) {
    let Some(arguments) = item.get("arguments").and_then(Value::as_object) else {
        return;
    };
    for (key, value) in arguments {
        input.entry(key.clone()).or_insert_with(|| value.clone());
    }
}

pub(super) fn mcp_tool_name(item: &Value) -> String {
    let server = item
        .get("server")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    mcp_tool_name_from_parts(server, item.get("tool").and_then(Value::as_str), "unknown")
}

pub(super) fn mcp_tool_name_from_parts(
    server: &str,
    raw_tool_name: Option<&str>,
    fallback: &str,
) -> String {
    match raw_tool_name {
        Some(name) if name.starts_with("mcp__") => name.to_string(),
        Some(name) if !name.is_empty() => format!("mcp__{server}__{name}"),
        _ => format!("mcp__{server}__{fallback}"),
    }
}

pub(super) fn dynamic_tool_name(item: &Value) -> String {
    let tool = item
        .get("tool")
        .and_then(Value::as_str)
        .unwrap_or("dynamic_tool");
    if let Some(canonical) = canonical_dynamic_tool_name(tool) {
        return canonical.to_string();
    }
    match item.get("namespace").and_then(Value::as_str) {
        Some(namespace) if !namespace.is_empty() => format!("{namespace}__{tool}"),
        _ => tool.to_string(),
    }
}

fn canonical_dynamic_tool_name(tool: &str) -> Option<&'static str> {
    match tool {
        "read" | "read_file" | "fs_read" | "fs_read_file" => Some("Read"),
        "list" | "ls" => Some("LS"),
        "glob" | "file_glob" | "find_files" => Some("Glob"),
        "grep" | "search" | "search_files" | "code_search" => Some("Grep"),
        "web_fetch" | "webfetch" | "fetch" => Some("WebFetch"),
        "web_search" | "web_search_preview" => Some("WebSearch"),
        _ => None,
    }
}

pub(super) fn collab_tool_name(item: &Value) -> String {
    let tool = item
        .get("tool")
        .and_then(Value::as_str)
        .unwrap_or("spawnAgent");
    // Codex's `spawn_agent` (raw OpenAI fn name) / `spawnAgent` (collab item
    // `tool` field) is the only collab op that creates a new sub-agent.
    // Normalize both casings to the provider-neutral `Agent` so the shared
    // sub-agent UI (parent block with `childBlocks`, used by Claude's `Task`
    // and OpenCode's `Agent`) handles it without provider branches.
    match tool {
        "spawn_agent" | "spawnAgent" => "Agent".to_string(),
        other => other.to_string(),
    }
}

pub(super) fn plan_todos(params: &Value) -> Value {
    let Some(plan) = params.get("plan").cloned() else {
        return Value::Array(Vec::new());
    };
    match serde_json::from_value::<Vec<PlanStep>>(plan) {
        Ok(steps) => Value::Array(steps.into_iter().map(plan_todo_value).collect()),
        Err(error) => {
            tracing::warn!(%error, "malformed Codex plan update payload");
            Value::Array(Vec::new())
        }
    }
}

pub(super) fn patch_from_changes(changes: Option<&Value>) -> Value {
    let Some(changes) = changes.and_then(Value::as_array) else {
        return Value::Null;
    };
    let mut lines = vec!["*** Begin Patch".to_string()];
    for change in changes {
        match serde_json::from_value::<FileChange>(change.clone()) {
            Ok(change) => append_patch_change(&mut lines, &change),
            Err(error) => tracing::warn!(%error, "malformed Codex file change entry"),
        }
    }
    lines.push("*** End Patch".to_string());
    Value::String(lines.join("\n"))
}

#[derive(Debug, Deserialize)]
struct PlanStep {
    #[serde(default)]
    step: String,
    #[serde(default)]
    status: PlanStepStatus,
}

#[derive(Debug, Default, Deserialize)]
enum PlanStepStatus {
    #[serde(rename = "inProgress")]
    InProgress,
    #[serde(rename = "completed")]
    Completed,
    #[default]
    #[serde(other)]
    Pending,
}

#[derive(Debug, Deserialize)]
struct FileChange {
    path: String,
    #[serde(default)]
    diff: String,
    #[serde(default)]
    kind: FileChangeKind,
}

#[derive(Debug, Default, Deserialize)]
struct FileChangeKind {
    #[serde(rename = "type", default = "default_change_kind")]
    kind: String,
    #[serde(default)]
    move_path: Option<String>,
}

fn plan_todo_value(step: PlanStep) -> Value {
    let content = step.step;
    serde_json::json!({
        "content": content,
        "status": plan_status(&step.status),
        "activeForm": content,
    })
}

fn plan_status(status: &PlanStepStatus) -> &'static str {
    match status {
        PlanStepStatus::InProgress => "in_progress",
        PlanStepStatus::Completed => "completed",
        PlanStepStatus::Pending => "pending",
    }
}

fn append_patch_change(lines: &mut Vec<String>, change: &FileChange) {
    match change.kind.kind.as_str() {
        "add" => append_add_patch(lines, &change.path, &change.diff),
        "delete" => append_delete_patch(lines, &change.path, &change.diff),
        _ => append_update_patch(
            lines,
            &change.path,
            change.kind.move_path.as_deref(),
            &change.diff,
        ),
    }
}

fn default_change_kind() -> String {
    "update".to_string()
}

fn append_add_patch(lines: &mut Vec<String>, path: &str, diff: &str) {
    lines.push(format!("*** Add File: {path}"));
    lines.extend(diff.lines().map(|line| format!("+{line}")));
}

fn append_update_patch(lines: &mut Vec<String>, path: &str, move_path: Option<&str>, diff: &str) {
    lines.push(format!("*** Update File: {path}"));
    if let Some(move_path) = move_path {
        lines.push(format!("*** Move to: {move_path}"));
    }
    lines.extend(diff.lines().map(ToOwned::to_owned));
}

fn append_delete_patch(lines: &mut Vec<String>, path: &str, diff: &str) {
    lines.push(format!("*** Delete File: {path}"));
    lines.extend(
        diff.lines()
            .filter(|line| line.starts_with('-'))
            .map(ToOwned::to_owned),
    );
}

#[cfg(test)]
mod tests {
    use super::{
        collab_tool_name, dynamic_tool_input, dynamic_tool_name, file_input, patch_from_changes,
    };
    use serde_json::json;

    #[test]
    fn collab_tool_name_normalizes_both_casings_of_spawn_agent_to_agent() {
        // Codex's collab item uses camelCase `spawnAgent` for `tool`, while
        // the raw OpenAI function_call uses snake_case `spawn_agent`. Both
        // must collapse to the provider-neutral `Agent` block name.
        assert_eq!(collab_tool_name(&json!({ "tool": "spawnAgent" })), "Agent");
        assert_eq!(collab_tool_name(&json!({ "tool": "spawn_agent" })), "Agent");
        assert_eq!(collab_tool_name(&json!({})), "Agent");
    }

    #[test]
    fn collab_tool_name_preserves_non_spawn_collab_operations() {
        assert_eq!(
            collab_tool_name(&json!({ "tool": "send_input" })),
            "send_input",
        );
        assert_eq!(
            collab_tool_name(&json!({ "tool": "close_agent" })),
            "close_agent",
        );
    }

    #[test]
    fn file_change_input_exposes_apply_patch_text() {
        let input = file_input(&json!({
            "status": "running",
            "changes": [{
                "path": "/workspace/toto.txt",
                "kind": { "type": "update", "move_path": null },
                "diff": "@@ -1 +1 @@\n-old\n+new\n"
            }]
        }));

        assert_eq!(
            input["patch_text"],
            "*** Begin Patch\n*** Update File: /workspace/toto.txt\n@@ -1 +1 @@\n-old\n+new\n*** End Patch"
        );
        assert_eq!(input["patch"], input["patch_text"]);
        assert_eq!(input["status"], "running");
    }

    #[test]
    fn command_input_preserves_command_actions() {
        let input = super::command_input(&json!({
            "command": "rg Codex",
            "commandActions": [{ "type": "search", "query": "Codex" }]
        }));

        assert_eq!(input["command"], "rg Codex");
        assert_eq!(
            input["commandActions"],
            json!([{ "type": "search", "query": "Codex" }])
        );
    }

    #[test]
    fn dynamic_tool_input_preserves_full_item_and_flattens_arguments() {
        let input = dynamic_tool_input(&json!({
            "type": "dynamicToolCall",
            "tool": "web_fetch",
            "arguments": { "url": "https://example.com", "format": "markdown" },
            "status": "completed"
        }));

        assert_eq!(input["type"], "dynamicToolCall");
        assert_eq!(input["arguments"]["url"], "https://example.com");
        assert_eq!(input["url"], "https://example.com");
        assert_eq!(input["status"], "completed");
    }

    #[test]
    fn dynamic_tool_name_canonicalizes_web_fetch() {
        assert_eq!(
            dynamic_tool_name(&json!({ "tool": "web_fetch" })),
            "WebFetch"
        );
    }

    #[test]
    fn add_patch_prefixes_added_lines() {
        let patch = patch_from_changes(Some(&json!([{
            "path": "/workspace/new.txt",
            "kind": { "type": "add" },
            "diff": "hello\nworld\n"
        }])));

        assert_eq!(
            patch,
            "*** Begin Patch\n*** Add File: /workspace/new.txt\n+hello\n+world\n*** End Patch"
        );
    }

    #[test]
    fn patch_updated_payload_can_reuse_patch_text_shape() {
        let patch = patch_from_changes(Some(&json!([{
            "path": "/workspace/toto.txt",
            "kind": { "type": "update" },
            "diff": "@@\n-a\n+b\n"
        }])));

        assert_eq!(
            patch,
            "*** Begin Patch\n*** Update File: /workspace/toto.txt\n@@\n-a\n+b\n*** End Patch"
        );
    }
}
