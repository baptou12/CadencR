use std::collections::HashMap;
use std::collections::HashSet;

use codex_app_server_sdk_rs::CodexAppServerClient;
use serde_json::{json, Value};

use super::with_timeout;
use crate::domain::agents::adapter::{RuntimeMcpServerConfig, RuntimeMcpServerStatus};

pub(super) fn thread_config(
    mcp_servers: Option<&HashMap<String, RuntimeMcpServerConfig>>,
) -> Value {
    let Some(servers) = mcp_servers else {
        return Value::Null;
    };
    let mut mcp_servers = serde_json::Map::new();
    for (name, config) in servers {
        let value = mcp_server_value(name, config.clone());
        mcp_servers.insert(name.clone(), value);
    }
    json!({ "mcp_servers": Value::Object(mcp_servers) })
}

pub(super) fn mcp_server_names(config: &Value) -> Vec<String> {
    config
        .get("mcp_servers")
        .and_then(Value::as_object)
        .map(|servers| servers.keys().cloned().collect())
        .unwrap_or_default()
}

pub(super) async fn mcp_server_statuses(
    client: &CodexAppServerClient,
    expected_names: &[String],
) -> Vec<RuntimeMcpServerStatus> {
    match with_timeout(
        "Codex mcpServerStatus/list",
        client.mcp_server_status_list(),
    )
    .await
    {
        Ok(response) => parse_mcp_server_statuses(&response, expected_names),
        Err(error) => {
            tracing::warn!(%error, "failed to read Codex MCP server statuses");
            expected_names
                .iter()
                .map(|name| RuntimeMcpServerStatus {
                    name: name.clone(),
                    status: "unknown".to_string(),
                })
                .collect()
        }
    }
}

fn mcp_server_value(name: &str, config: RuntimeMcpServerConfig) -> Value {
    match config {
        RuntimeMcpServerConfig::Stdio { command, args, env } => {
            let mut env = env.unwrap_or_default();
            if matches!(name, "cadence-plan" | "cadence-prd") {
                env.insert(
                    "CADENCE_MCP_APPROVAL_MODE".to_string(),
                    "elicitation".to_string(),
                );
            }
            json!({
                "command": command,
                "args": args.unwrap_or_default(),
                "env": env,
            })
        }
    }
}

fn parse_mcp_server_statuses(
    response: &Value,
    expected_names: &[String],
) -> Vec<RuntimeMcpServerStatus> {
    let servers = response
        .get("data")
        .and_then(Value::as_array)
        .map(|servers| {
            servers
                .iter()
                .filter_map(McpServerHealth::from_value)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if expected_names.is_empty() {
        return servers
            .into_iter()
            .map(|server| RuntimeMcpServerStatus {
                status: server.status(),
                name: server.name,
            })
            .collect();
    }

    expected_names
        .iter()
        .map(|name| RuntimeMcpServerStatus {
            name: name.clone(),
            status: servers
                .iter()
                .find(|server| server.name == *name)
                .map_or_else(|| "unavailable".to_string(), McpServerHealth::status),
        })
        .collect()
}

struct McpServerHealth {
    name: String,
    auth_ok: bool,
    tools: HashSet<String>,
}

impl McpServerHealth {
    fn from_value(value: &Value) -> Option<Self> {
        let name = value.get("name").and_then(Value::as_str)?.to_string();
        let auth_ok = value
            .get("authStatus")
            .and_then(Value::as_str)
            .map_or(true, |status| status != "notLoggedIn");
        let tools = tool_names(value.get("tools"));
        Some(Self {
            name,
            auth_ok,
            tools,
        })
    }

    fn status(&self) -> String {
        if self.auth_ok
            && required_tools(&self.name)
                .iter()
                .all(|tool| self.tools.contains(*tool))
        {
            "connected".to_string()
        } else {
            "unavailable".to_string()
        }
    }
}

fn tool_names(value: Option<&Value>) -> HashSet<String> {
    match value {
        Some(Value::Object(tools)) => tools.keys().cloned().collect(),
        Some(Value::Array(tools)) => tools
            .iter()
            .filter_map(|tool| {
                tool.get("name")
                    .and_then(Value::as_str)
                    .or_else(|| tool.as_str())
            })
            .map(ToOwned::to_owned)
            .collect(),
        _ => HashSet::new(),
    }
}

fn required_tools(server_name: &str) -> &'static [&'static str] {
    match server_name {
        "cadence-plan" | "cadence-session" => &["show_plan", "mark_agent_done"],
        "cadence-prd" => &["show_prd", "mark_agent_done"],
        name if name.starts_with("cadence-") => &["mark_agent_done"],
        _ => &[],
    }
}

#[cfg(test)]
mod tests {
    use super::{mcp_server_value, parse_mcp_server_statuses};
    use crate::domain::agents::adapter::RuntimeMcpServerConfig;
    use serde_json::json;

    #[test]
    fn mcp_statuses_do_not_assume_missing_servers_are_connected() {
        let expected = vec!["cadence-plan".to_string(), "cadence-prd".to_string()];
        let statuses = parse_mcp_server_statuses(
            &json!({
                "data": [{
                    "name": "cadence-plan",
                    "authStatus": "unsupported",
                    "tools": {
                        "show_plan": {},
                        "mark_agent_done": {}
                    }
                }]
            }),
            &expected,
        );
        assert_eq!(statuses[0].status, "connected");
        assert_eq!(statuses[1].status, "unavailable");
    }

    #[test]
    fn mcp_statuses_return_ready_servers_when_no_expected_list_exists() {
        let statuses = parse_mcp_server_statuses(
            &json!({
                "data": [
                    {
                        "name": "cadence-plan",
                        "authStatus": "unsupported",
                        "tools": {
                            "show_plan": {},
                            "mark_agent_done": {}
                        }
                    },
                    { "name": "custom" }
                ]
            }),
            &[],
        );

        assert_eq!(statuses.len(), 2);
        assert_eq!(statuses[0].name, "cadence-plan");
        assert_eq!(statuses[0].status, "connected");
        assert_eq!(statuses[1].name, "custom");
        assert_eq!(statuses[1].status, "connected");
    }

    #[test]
    fn mcp_statuses_mark_expected_servers_unavailable_for_malformed_response() {
        let expected = vec!["cadence-plan".to_string()];
        let statuses = parse_mcp_server_statuses(&json!({ "oops": true }), &expected);

        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].name, "cadence-plan");
        assert_eq!(statuses[0].status, "unavailable");
    }

    #[test]
    fn mcp_statuses_require_expected_tools_and_auth() {
        let expected = vec![
            "cadence-plan".to_string(),
            "cadence-prd".to_string(),
            "cadence-execute".to_string(),
        ];
        let statuses = parse_mcp_server_statuses(
            &json!({
                "data": [
                    {
                        "name": "cadence-plan",
                        "authStatus": "unsupported",
                        "tools": { "show_plan": {} }
                    },
                    {
                        "name": "cadence-prd",
                        "authStatus": "notLoggedIn",
                        "tools": { "show_prd": {}, "mark_agent_done": {} }
                    },
                    {
                        "name": "cadence-execute",
                        "authStatus": "unsupported",
                        "tools": { "mark_agent_done": {} }
                    }
                ]
            }),
            &expected,
        );

        assert_eq!(statuses[0].status, "unavailable");
        assert_eq!(statuses[1].status, "unavailable");
        assert_eq!(statuses[2].status, "connected");
    }

    #[test]
    fn approval_elicitation_env_is_limited_to_cadence_servers() {
        let server = |name| {
            mcp_server_value(
                name,
                RuntimeMcpServerConfig::Stdio {
                    command: "server".to_string(),
                    args: None,
                    env: None,
                },
            )
        };

        assert_eq!(
            server("cadence-plan")["env"]["CADENCE_MCP_APPROVAL_MODE"],
            json!("elicitation")
        );
        assert!(server("custom")["env"]["CADENCE_MCP_APPROVAL_MODE"].is_null());
    }
}
