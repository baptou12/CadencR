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
    fn non_cadencr_namespaces_keep_codex_raw_namespace_shape() {
        let name = function_tool_name(&json!({
            "namespace": "mcp__chrome_devtools__",
            "name": "click"
        }));

        assert_eq!(name, "mcp__chrome_devtools____click");
    }
}
