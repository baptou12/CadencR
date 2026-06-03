use std::collections::{HashMap, HashSet};
use std::time::Duration;

use codex_app_server_sdk_rs::{AppServerEvent, CodexAppServerClient, CodexMcpServerStatus};
use serde_json::Value;
use tokio::sync::broadcast;

use super::with_timeout;
use crate::domain::agents::adapter::RuntimeMcpServerStatus;
use crate::domain::mcp::servers::cadencr_mcp_required_tools;

const MCP_STARTUP_TIMEOUT: Duration = Duration::from_secs(3);

pub(super) async fn mcp_server_statuses(
    client: &CodexAppServerClient,
    startup_events: &mut broadcast::Receiver<AppServerEvent>,
    expected_names: &[String],
) -> Vec<RuntimeMcpServerStatus> {
    let listed =
        match with_timeout("Codex mcpServerStatus/list", client.available_mcp_servers()).await {
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
        };
    let unresolved = unresolved_expected_names(&listed, expected_names);
    if expected_names.is_empty() || unresolved.is_empty() {
        return listed;
    }

    let startup_statuses = wait_for_startup_statuses(startup_events, &unresolved).await;
    merge_startup_statuses(listed, &startup_statuses)
}

async fn wait_for_startup_statuses(
    startup_events: &mut broadcast::Receiver<AppServerEvent>,
    expected_names: &[String],
) -> HashMap<String, String> {
    let mut statuses = HashMap::new();
    let wait = async {
        while !startup_statuses_are_terminal(&statuses, expected_names) {
            match startup_events.recv().await {
                Ok(AppServerEvent::Notification { method, params })
                    if method == "mcpServer/startupStatus/updated" =>
                {
                    if let Some((name, status)) = startup_status(&params) {
                        statuses.insert(name, status);
                    }
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    let _ = tokio::time::timeout(MCP_STARTUP_TIMEOUT, wait).await;
    statuses
}

fn startup_status(params: &Value) -> Option<(String, String)> {
    Some((
        params.get("name")?.as_str()?.to_string(),
        params.get("status")?.as_str()?.to_string(),
    ))
}

fn startup_statuses_are_terminal(
    statuses: &HashMap<String, String>,
    expected_names: &[String],
) -> bool {
    expected_names.iter().all(|name| {
        statuses
            .get(name)
            .is_some_and(|status| matches!(status.as_str(), "ready" | "failed" | "error"))
    })
}

fn unresolved_expected_names(
    statuses: &[RuntimeMcpServerStatus],
    expected_names: &[String],
) -> Vec<String> {
    expected_names
        .iter()
        .filter(|name| {
            !statuses
                .iter()
                .any(|status| status.name == **name && status.status == "connected")
        })
        .cloned()
        .collect()
}

fn merge_startup_statuses(
    mut listed: Vec<RuntimeMcpServerStatus>,
    startup_statuses: &HashMap<String, String>,
) -> Vec<RuntimeMcpServerStatus> {
    for status in &mut listed {
        if let Some(startup_status) = startup_statuses.get(&status.name) {
            if startup_status == "ready" {
                status.status = "connected".to_string();
            } else if matches!(startup_status.as_str(), "failed" | "error") {
                status.status = "unavailable".to_string();
            }
        }
    }
    listed
}

pub(super) fn parse_mcp_server_statuses(
    response: &[CodexMcpServerStatus],
    expected_names: &[String],
) -> Vec<RuntimeMcpServerStatus> {
    let servers = response
        .iter()
        .map(McpServerHealth::from)
        .collect::<Vec<_>>();

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
    fn from(status: &CodexMcpServerStatus) -> Self {
        let auth_ok = status
            .auth_status
            .as_deref()
            .map_or(true, |status| status != "notLoggedIn");
        Self {
            name: status.name.clone(),
            auth_ok,
            tools: status.tool_names.iter().cloned().collect(),
        }
    }

    fn status(&self) -> String {
        if self.auth_ok
            && cadencr_mcp_required_tools(&self.name)
                .iter()
                .all(|tool| self.tools.contains(tool))
        {
            "connected".to_string()
        } else {
            "unavailable".to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{merge_startup_statuses, parse_mcp_server_statuses};
    use codex_app_server_sdk_rs::CodexMcpServerStatus;
    use std::collections::HashMap;

    fn status(name: &str, auth_status: Option<&str>, tool_names: &[&str]) -> CodexMcpServerStatus {
        CodexMcpServerStatus {
            name: name.to_string(),
            auth_status: auth_status.map(ToOwned::to_owned),
            tool_names: tool_names.iter().map(|tool| (*tool).to_string()).collect(),
        }
    }

    #[test]
    fn mcp_statuses_do_not_assume_missing_servers_are_connected() {
        let expected = vec!["cadencr-session".to_string(), "cadencr-extra".to_string()];
        let statuses = parse_mcp_server_statuses(
            &[status(
                "cadencr-session",
                Some("unsupported"),
                &["mark_agent_done"],
            )],
            &expected,
        );
        assert_eq!(statuses[0].status, "connected");
        assert_eq!(statuses[1].status, "unavailable");
    }

    #[test]
    fn mcp_statuses_return_ready_servers_when_no_expected_list_exists() {
        let statuses = parse_mcp_server_statuses(
            &[
                status("cadencr-session", Some("unsupported"), &["mark_agent_done"]),
                status("custom", None, &[]),
            ],
            &[],
        );

        assert_eq!(statuses.len(), 2);
        assert_eq!(statuses[0].name, "cadencr-session");
        assert_eq!(statuses[0].status, "connected");
        assert_eq!(statuses[1].name, "custom");
        assert_eq!(statuses[1].status, "connected");
    }

    #[test]
    fn mcp_statuses_mark_expected_servers_unavailable_for_malformed_response() {
        let expected = vec!["cadencr-session".to_string()];
        let statuses = parse_mcp_server_statuses(&[], &expected);

        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].name, "cadencr-session");
        assert_eq!(statuses[0].status, "unavailable");
    }

    #[test]
    fn startup_ready_status_overrides_empty_status_list_for_expected_server() {
        let expected = vec!["cadencr-session".to_string()];
        let listed = parse_mcp_server_statuses(&[], &expected);
        let statuses = merge_startup_statuses(
            listed,
            &HashMap::from([("cadencr-session".to_string(), "ready".to_string())]),
        );

        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].name, "cadencr-session");
        assert_eq!(statuses[0].status, "connected");
    }

    #[test]
    fn mcp_statuses_require_expected_tools_and_auth() {
        let expected = vec!["cadencr-session".to_string()];
        let statuses = parse_mcp_server_statuses(
            &[status(
                "cadencr-session",
                Some("unsupported"),
                &["mark_agent_done"],
            )],
            &expected,
        );

        assert_eq!(statuses[0].status, "connected");
    }
}
