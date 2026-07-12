use std::sync::RwLock;

use super::adapter::RuntimeMcpServerStatus;

/// Resolves providers that flatten MCP calls to `<server>_<tool>` into the
/// provider-neutral `mcp__<server>__<tool>` name used by the conversation UI.
#[derive(Default)]
pub(crate) struct McpToolNameResolver {
    server_names: RwLock<Vec<String>>,
}

impl McpToolNameResolver {
    pub fn remember(&self, servers: &[RuntimeMcpServerStatus]) {
        let mut names = servers
            .iter()
            .map(|server| server.name.clone())
            .collect::<Vec<_>>();
        names.sort_by(|left, right| right.len().cmp(&left.len()).then_with(|| left.cmp(right)));
        names.dedup();
        *self
            .server_names
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = names;
    }

    pub fn canonical_name(&self, raw: &str) -> Option<String> {
        if raw.starts_with("mcp__") {
            return None;
        }
        let names = self
            .server_names
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        names.iter().find_map(|server| {
            raw.strip_prefix(server)
                .and_then(|rest| rest.strip_prefix('_'))
                .filter(|tool| !tool.is_empty())
                .map(|tool| format!("mcp__{server}__{tool}"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::McpToolNameResolver;
    use crate::domain::agents::adapter::RuntimeMcpServerStatus;

    fn status(name: &str) -> RuntimeMcpServerStatus {
        RuntimeMcpServerStatus {
            name: name.to_string(),
            status: "connected".to_string(),
        }
    }

    #[test]
    fn resolves_bare_names_using_the_longest_known_server_prefix() {
        let resolver = McpToolNameResolver::default();
        resolver.remember(&[status("chrome"), status("chrome-devtools")]);

        assert_eq!(
            resolver.canonical_name("chrome-devtools_take_screenshot"),
            Some("mcp__chrome-devtools__take_screenshot".to_string())
        );
    }

    #[test]
    fn leaves_unrecognized_bare_tools_unchanged() {
        let resolver = McpToolNameResolver::default();
        resolver.remember(&[status("codegraph")]);

        assert_eq!(resolver.canonical_name("custom_tool"), None);
    }
}
