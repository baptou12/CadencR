pub mod session;

use std::sync::Arc;

use rmcp::model::{Implementation, ServerCapabilities, ServerInfo};

use self::session::SessionServer;
use super::context::McpContext;

/// Agent types that can be served.
///
/// After the ws-feature removal only the ws-session agent type is exposed —
/// the legacy plan/prd/execute/qa/review/risk/retro multi-stage workflow is
/// gone. The enum is kept as a single-variant type for forward-compatibility
/// with future agent kinds and to preserve the existing `mcp_server_name`
/// plumbing.
#[derive(Debug, Clone, Copy)]
pub enum AgentType {
    Session,
}

impl AgentType {
    pub const ALL: &'static [AgentType] = &[AgentType::Session];

    /// Short identifier used in MCP server names (`cadencr-<short>`).
    pub fn short_name(self) -> &'static str {
        match self {
            Self::Session => "session",
        }
    }
}

impl std::str::FromStr for AgentType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        AgentType::ALL
            .iter()
            .copied()
            .find(|t| t.short_name() == s)
            .ok_or_else(|| format!("Unknown agent type: {s}"))
    }
}

/// Names of tools that the agent must expose for the MCP server to be
/// considered healthy. Today the only such tool is `mark_agent_done`.
pub fn cadencr_mcp_required_tools(server_name: &str) -> Vec<String> {
    if cadencr_agent_type_from_server_name(server_name).is_some() {
        vec!["mark_agent_done".to_string()]
    } else {
        Vec::new()
    }
}

/// Whether the named server runs any tool that requires the elicitation
/// approval flow. After the ws-feature removal no tools require approval
/// elicitation; this always returns `false` but is kept so callers in the
/// codex adapter don't have to be rewritten.
pub fn cadencr_mcp_uses_approval_elicitation(_server_name: &str) -> bool {
    false
}

/// Whether a specific tool requires approval elicitation. Always `false`
/// in the post-cleanup world — see `cadencr_mcp_uses_approval_elicitation`.
#[allow(dead_code)]
pub fn cadencr_mcp_tool_requires_approval_elicitation(
    _server_name: &str,
    _tool_name: &str,
) -> bool {
    false
}

fn cadencr_agent_type_from_server_name(server_name: &str) -> Option<AgentType> {
    let short_name = server_name.strip_prefix("cadencr-")?;
    short_name.parse().ok()
}

/// A type-erased MCP server wrapper. Only `Session` remains after the
/// ws-feature cleanup.
pub enum McpServer {
    Session(SessionServer),
}

/// Create the MCP server for the given agent type.
pub fn create_mcp_server(agent_type: AgentType, ctx: Arc<McpContext>) -> McpServer {
    match agent_type {
        AgentType::Session => McpServer::Session(SessionServer::new(ctx)),
    }
}

/// Returns the MCP server name string for the given agent type.
#[allow(dead_code)]
pub fn mcp_server_name(agent_type: AgentType) -> String {
    format!("cadencr-{}", agent_type.short_name())
}

fn server_info(name: &str) -> ServerInfo {
    let caps = ServerCapabilities::builder().enable_tools().build();
    ServerInfo::new(caps).with_server_info(Implementation::new(name, "1.0.0"))
}

#[cfg(test)]
mod tests {
    use super::{cadencr_mcp_required_tools, mcp_server_name, AgentType};

    #[test]
    fn mcp_server_name_uses_current_cadencr_prefix() {
        assert_eq!(mcp_server_name(AgentType::Session), "cadencr-session");
    }

    #[test]
    fn required_tools_contains_mark_agent_done_for_cadencr_servers() {
        assert_eq!(
            cadencr_mcp_required_tools("cadencr-session"),
            vec!["mark_agent_done".to_string()]
        );
    }

    #[test]
    fn required_tools_rejects_legacy_prefix() {
        assert!(cadencr_mcp_required_tools("legacy-session").is_empty());
    }
}
