//! Schema-correct stdio MCP payload builder.
//!
//! ACP's `session/new` / `session/load` expect each stdio MCP server to
//! carry `args: []` and `env: []` arrays unconditionally, with `env`
//! shaped as a list of `{ "name", "value" }` objects (not a JSON map).
//! This module builds that payload from our internal
//! `RuntimeMcpServerConfig::Stdio` representation.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::domain::agents::adapter::RuntimeMcpServerConfig;

/// Build the `mcpServers` array passed to `session/new` / `session/load`.
///
/// Always emits `args: []` and `env: []` as arrays, even when the source
/// has none. `env` is converted from our internal `HashMap<String, String>`
/// to ACP's `[{name, value}]` list shape.
pub fn build_stdio_mcp_payload(servers: Option<&HashMap<String, RuntimeMcpServerConfig>>) -> Value {
    let Some(servers) = servers else {
        return Value::Array(Vec::new());
    };
    let mut payload = Vec::with_capacity(servers.len());
    for (name, config) in servers {
        match config {
            RuntimeMcpServerConfig::Stdio { command, args, env } => {
                payload.push(json!({
                    "name": name,
                    "command": command,
                    "args": args.clone().unwrap_or_default(),
                    "env": env_to_acp_array(env.as_ref()),
                }));
            }
        }
    }
    Value::Array(payload)
}

/// Convert an internal env map to ACP's `[{name, value}]` array form.
/// Sorted by name so callers (and tests) get deterministic output.
fn env_to_acp_array(env: Option<&HashMap<String, String>>) -> Value {
    let Some(env) = env else {
        return Value::Array(Vec::new());
    };
    let mut entries: Vec<(&String, &String)> = env.iter().collect();
    entries.sort_by(|a, b| a.0.cmp(b.0));
    Value::Array(
        entries
            .into_iter()
            .map(|(name, value)| json!({ "name": name, "value": value }))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::build_stdio_mcp_payload;
    use crate::domain::agents::adapter::RuntimeMcpServerConfig;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn none_servers_returns_empty_array() {
        assert!(build_stdio_mcp_payload(None).as_array().unwrap().is_empty());
    }

    #[test]
    fn empty_args_and_env_serialize_as_empty_arrays() {
        let mut servers = HashMap::new();
        servers.insert(
            "fs".to_string(),
            RuntimeMcpServerConfig::Stdio {
                command: "/bin/mcp-fs".to_string(),
                args: None,
                env: None,
            },
        );
        let payload = build_stdio_mcp_payload(Some(&servers));
        let entry = &payload.as_array().unwrap()[0];
        assert_eq!(entry["name"], "fs");
        assert_eq!(entry["command"], "/bin/mcp-fs");
        assert_eq!(entry["args"], json!([]));
        assert_eq!(entry["env"], json!([]));
    }

    #[test]
    fn args_are_emitted_as_array_when_present() {
        let mut servers = HashMap::new();
        servers.insert(
            "fs".to_string(),
            RuntimeMcpServerConfig::Stdio {
                command: "/bin/mcp-fs".to_string(),
                args: Some(vec!["--mode".into(), "ro".into()]),
                env: None,
            },
        );
        let payload = build_stdio_mcp_payload(Some(&servers));
        let entry = &payload.as_array().unwrap()[0];
        assert_eq!(entry["args"], json!(["--mode", "ro"]));
    }

    #[test]
    fn env_is_emitted_as_array_of_name_value_objects_sorted() {
        let mut env = HashMap::new();
        env.insert("BETA".to_string(), "2".to_string());
        env.insert("ALPHA".to_string(), "1".to_string());
        let mut servers = HashMap::new();
        servers.insert(
            "fs".to_string(),
            RuntimeMcpServerConfig::Stdio {
                command: "/bin/mcp-fs".to_string(),
                args: None,
                env: Some(env),
            },
        );
        let payload = build_stdio_mcp_payload(Some(&servers));
        let entry = &payload.as_array().unwrap()[0];
        // Deterministic order via internal sort.
        assert_eq!(
            entry["env"],
            json!([
                { "name": "ALPHA", "value": "1" },
                { "name": "BETA",  "value": "2" },
            ])
        );
    }
}
