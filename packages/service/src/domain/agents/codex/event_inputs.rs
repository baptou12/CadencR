use serde_json::Value;

pub(super) fn command_input(item: &Value) -> Value {
    serde_json::json!({
        "command": item.get("command").cloned().unwrap_or(Value::Null),
        "cwd": item.get("cwd").cloned().unwrap_or(Value::Null),
        "status": item.get("status").cloned().unwrap_or(Value::Null),
        "output": item.get("aggregatedOutput").cloned().unwrap_or(Value::Null),
        "exitCode": item.get("exitCode").cloned().unwrap_or(Value::Null),
    })
}

pub(super) fn file_input(item: &Value) -> Value {
    let patch_text = patch_from_changes(item.get("changes"));
    serde_json::json!({
        "patch_text": patch_text.clone(),
        "patch": patch_text,
        "changes": item.get("changes").cloned().unwrap_or(Value::Null),
        "status": item.get("status").cloned().unwrap_or(Value::Null),
    })
}

pub(super) fn mcp_input(item: &Value) -> Value {
    serde_json::json!({
        "arguments": item.get("arguments").cloned().unwrap_or(Value::Null),
        "result": item.get("result").cloned().unwrap_or(Value::Null),
        "error": item.get("error").cloned().unwrap_or(Value::Null),
        "status": item.get("status").cloned().unwrap_or(Value::Null),
    })
}

pub(super) fn dynamic_tool_input(item: &Value) -> Value {
    serde_json::json!({
        "namespace": item.get("namespace").cloned().unwrap_or(Value::Null),
        "tool": item.get("tool").cloned().unwrap_or(Value::Null),
        "arguments": item.get("arguments").cloned().unwrap_or(Value::Null),
        "status": item.get("status").cloned().unwrap_or(Value::Null),
        "contentItems": item.get("contentItems").cloned().unwrap_or(Value::Null),
        "success": item.get("success").cloned().unwrap_or(Value::Null),
    })
}

pub(super) fn collab_tool_input(item: &Value) -> Value {
    serde_json::json!({
        "tool": item.get("tool").cloned().unwrap_or(Value::Null),
        "status": item.get("status").cloned().unwrap_or(Value::Null),
        "senderThreadId": item.get("senderThreadId").cloned().unwrap_or(Value::Null),
        "receiverThreadIds": item.get("receiverThreadIds").cloned().unwrap_or(Value::Null),
        "prompt": item.get("prompt").cloned().unwrap_or(Value::Null),
        "model": item.get("model").cloned().unwrap_or(Value::Null),
        "reasoningEffort": item.get("reasoningEffort").cloned().unwrap_or(Value::Null),
        "agentsStates": item.get("agentsStates").cloned().unwrap_or(Value::Null),
    })
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
    match item.get("namespace").and_then(Value::as_str) {
        Some(namespace) if !namespace.is_empty() => format!("{namespace}__{tool}"),
        _ => tool.to_string(),
    }
}

pub(super) fn collab_tool_name(item: &Value) -> String {
    item.get("tool")
        .and_then(Value::as_str)
        .unwrap_or("spawn_agent")
        .to_string()
}

pub(super) fn plan_todos(params: &Value) -> Value {
    params
        .get("plan")
        .and_then(Value::as_array)
        .map(|steps| {
            steps
                .iter()
                .map(|step| {
                    let content = step.get("step").and_then(Value::as_str).unwrap_or("");
                    serde_json::json!({
                        "content": content,
                        "status": plan_status(step),
                        "activeForm": content,
                    })
                })
                .collect::<Vec<Value>>()
        })
        .map(Value::Array)
        .unwrap_or_else(|| Value::Array(Vec::new()))
}

pub(super) fn patch_from_changes(changes: Option<&Value>) -> Value {
    let Some(changes) = changes.and_then(Value::as_array) else {
        return Value::Null;
    };
    let mut lines = vec!["*** Begin Patch".to_string()];
    for change in changes {
        append_patch_change(&mut lines, change);
    }
    lines.push("*** End Patch".to_string());
    Value::String(lines.join("\n"))
}

fn plan_status(step: &Value) -> &'static str {
    match step.get("status").and_then(Value::as_str) {
        Some("inProgress") => "in_progress",
        Some("completed") => "completed",
        _ => "pending",
    }
}

fn append_patch_change(lines: &mut Vec<String>, change: &Value) {
    let Some(path) = change.get("path").and_then(Value::as_str) else {
        return;
    };
    let diff = change.get("diff").and_then(Value::as_str).unwrap_or("");
    match change_kind(change) {
        "add" => append_add_patch(lines, path, diff),
        "delete" => append_delete_patch(lines, path, diff),
        _ => append_update_patch(lines, path, move_path(change), diff),
    }
}

fn change_kind(change: &Value) -> &str {
    change
        .get("kind")
        .and_then(|kind| kind.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("update")
}

fn move_path(change: &Value) -> Option<&str> {
    change
        .get("kind")
        .and_then(|kind| kind.get("move_path"))
        .and_then(Value::as_str)
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
    use super::{file_input, patch_from_changes};
    use serde_json::json;

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
