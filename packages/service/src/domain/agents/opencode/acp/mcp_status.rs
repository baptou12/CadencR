use crate::domain::agents::adapter::RuntimeMcpServerStatus;

pub(super) fn merge_configured_mcp_servers(
    mut listed: Vec<RuntimeMcpServerStatus>,
    configured: Vec<RuntimeMcpServerStatus>,
) -> Vec<RuntimeMcpServerStatus> {
    for server in configured {
        if listed
            .iter()
            .any(|listed_server| listed_server.name == server.name)
        {
            continue;
        }
        listed.push(server);
    }
    listed
}

#[cfg(test)]
mod tests {
    use super::merge_configured_mcp_servers;
    use crate::domain::agents::adapter::RuntimeMcpServerStatus;

    #[test]
    fn keeps_cadencr_browser_when_cli_lists_other_servers() {
        let listed = vec![RuntimeMcpServerStatus {
            name: "project-server".to_string(),
            status: "connected".to_string(),
        }];
        let configured = vec![RuntimeMcpServerStatus {
            name: "cadencr-browser".to_string(),
            status: "unknown".to_string(),
        }];

        let merged = merge_configured_mcp_servers(listed, configured);

        assert!(merged.iter().any(|server| server.name == "project-server"));
        assert!(merged.iter().any(|server| server.name == "cadencr-browser"));
    }
}
