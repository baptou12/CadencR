use serde_json::Value;

pub(super) fn function_tool_name(item: &Value) -> String {
    let raw_name = string_field(item, "name", "function_call");
    let canonical = canonical_tool_name(&raw_name);
    if canonical != raw_name || raw_name.starts_with("mcp__") {
        return canonical;
    }
    match item.get("namespace").and_then(Value::as_str) {
        Some(namespace) if !namespace.is_empty() => namespaced_tool_name(namespace, &raw_name),
        _ => raw_name,
    }
}

pub(super) fn string_field(item: &Value, field: &str, fallback: &str) -> String {
    item.get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn namespaced_tool_name(namespace: &str, tool: &str) -> String {
    canonical_cadencr_namespace(namespace)
        .map(|server| format!("mcp__{server}__{tool}"))
        .unwrap_or_else(|| format!("{namespace}__{tool}"))
}

fn canonical_cadencr_namespace(namespace: &str) -> Option<String> {
    let rest = namespace.strip_prefix("mcp__cadencr_")?;
    let server = rest.strip_suffix("__").unwrap_or(rest);
    if server.is_empty() {
        return None;
    }
    Some(format!("cadencr-{server}"))
}

pub(super) fn canonical_tool_name(name: &str) -> String {
    match name {
        "read" | "read_file" | "fs_read" | "fs_read_file" => "Read".to_string(),
        "glob" | "file_glob" | "find_files" => "Glob".to_string(),
        "grep" | "search" | "search_files" | "code_search" => "Grep".to_string(),
        "bash" | "shell" | "exec" | "exec_command" => "Bash".to_string(),
        "web_search" | "web_search_preview" => "WebSearch".to_string(),
        "web_fetch" | "webfetch" | "fetch" => "WebFetch".to_string(),
        "tool_search" => "ToolSearch".to_string(),
        // Codex's `spawn_agent` is the only collab op that creates a new
        // sub-agent. Normalize to the provider-neutral `Agent` name so the
        // frontend's existing sub-agent UI (used by Claude's `Task` and
        // OpenCode's `Agent` tools) creates the wrapping block with
        // `childBlocks` and nests downstream events inside it. Other collab
        // ops (`wait_agent`, `send_input`, `resume_agent`, `close_agent`)
        // act on existing sub-agents and keep their literal names.
        "spawn_agent" => "Agent".to_string(),
        _ => name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::function_tool_name;
    use serde_json::json;

    #[test]
    fn cadencr_namespace_tools_use_canonical_backend_names() {
        let name = function_tool_name(&json!({
            "namespace": "mcp__cadencr_plan__",
            "name": "read_plan"
        }));

        assert_eq!(name, "mcp__cadencr-plan__read_plan");
    }

    #[test]
    fn spawn_agent_function_name_normalizes_to_agent() {
        // Codex's `spawn_agent` is the only collab op that creates a new
        // sub-agent thread; we normalize it to the provider-neutral `Agent`
        // name so the frontend's existing sub-agent UI applies without any
        // codex-specific branch.
        let name = function_tool_name(&json!({ "name": "spawn_agent" }));
        assert_eq!(name, "Agent");
    }

    #[test]
    fn other_collab_function_names_keep_their_literal_name() {
        // wait/send/resume/close act on existing sub-agents and shouldn't
        // be folded into the same UI bucket as the spawning call.
        for raw in ["wait_agent", "send_input", "resume_agent", "close_agent"] {
            let name = function_tool_name(&json!({ "name": raw }));
            assert_eq!(name, raw, "expected pass-through for {raw}");
        }
    }

    #[test]
    fn non_cadencr_namespaces_keep_codex_raw_namespace_shape() {
        let name = function_tool_name(&json!({
            "namespace": "mcp__chrome_devtools__",
            "name": "click"
        }));

        assert_eq!(name, "mcp__chrome_devtools____click");
    }
}
