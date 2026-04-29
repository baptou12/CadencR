mod approval_elicitation;
pub mod composable;
pub mod plan;
pub mod session;
mod tool_catalog;
pub mod tool_handlers;
mod tool_specs;

use std::sync::Arc;

use rmcp::model::{Implementation, ServerCapabilities, ServerInfo};

use self::tool_specs::{approval_elicitation_tool_names_for_agent, required_tool_names_for_agent};
use self::{composable::ComposableServer, plan::PlanServer, session::SessionServer};
use super::context::McpContext;

/// Agent types that can be served
#[derive(Debug, Clone, Copy)]
pub enum AgentType {
    Plan,
    Prd,
    Execute,
    Qa,
    Review,
    Risk,
    Retro,
    Session,
}

impl AgentType {
    pub const ALL: &'static [AgentType] = &[
        AgentType::Plan,
        AgentType::Prd,
        AgentType::Execute,
        AgentType::Qa,
        AgentType::Review,
        AgentType::Risk,
        AgentType::Retro,
        AgentType::Session,
    ];

    /// Short identifier used in `opencode.json` permission keys and DB rows
    /// (the suffix after `cadencr-` in `mcp_server_name`).
    pub fn short_name(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Prd => "prd",
            Self::Execute => "execute",
            Self::Qa => "qa",
            Self::Review => "review",
            Self::Risk => "risk",
            Self::Retro => "retro",
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

pub fn cadence_mcp_uses_approval_elicitation(server_name: &str) -> bool {
    cadence_agent_type_from_server_name(server_name)
        .is_some_and(|agent_type| !approval_elicitation_tool_names_for_agent(agent_type).is_empty())
}

pub fn cadence_mcp_tool_requires_approval_elicitation(server_name: &str, tool_name: &str) -> bool {
    cadence_agent_type_from_server_name(server_name).is_some_and(|agent_type| {
        approval_elicitation_tool_names_for_agent(agent_type)
            .iter()
            .any(|name| name == tool_name)
    })
}

pub fn cadence_mcp_required_tools(server_name: &str) -> Vec<String> {
    cadence_agent_type_from_server_name(server_name)
        .map(required_tool_names_for_agent)
        .unwrap_or_default()
}

fn cadence_agent_type_from_server_name(server_name: &str) -> Option<AgentType> {
    let short_name = server_name
        .strip_prefix("cadencr-")
        .or_else(|| server_name.strip_prefix("cadence-"))?;
    short_name.parse().ok()
}

/// A type-erased MCP server wrapper that can hold any agent server type.
/// Needed because `ServerHandler` is not dyn-compatible (requires `Self: Sized`).
pub enum McpServer {
    Composable(ComposableServer),
    Plan(PlanServer),
    Session(SessionServer),
}

/// Create the appropriate MCP server for the given agent type.
pub fn create_mcp_server(agent_type: AgentType, ctx: Arc<McpContext>) -> McpServer {
    match agent_type {
        AgentType::Plan => McpServer::Plan(PlanServer::new(ctx)),
        AgentType::Session => McpServer::Session(SessionServer::new(ctx)),
        _ => McpServer::Composable(ComposableServer::new(
            mcp_server_name(agent_type),
            tool_handlers::registrations_for_agent(agent_type, &ctx),
            ctx.feature_id,
        )),
    }
}

/// Returns the MCP server name string for the given agent type.
pub fn mcp_server_name(agent_type: AgentType) -> String {
    format!("cadencr-{}", agent_type.short_name())
}

fn server_info(name: &str) -> ServerInfo {
    let caps = ServerCapabilities::builder().enable_tools().build();
    ServerInfo::new(caps).with_server_info(Implementation::new(name, "1.0.0"))
}

#[cfg(test)]
mod tests {
    use super::{
        cadence_mcp_required_tools, cadence_mcp_tool_requires_approval_elicitation,
        cadence_mcp_uses_approval_elicitation, mcp_server_name, AgentType,
    };

    #[test]
    fn mcp_server_name_uses_current_cadencr_prefix() {
        assert_eq!(mcp_server_name(AgentType::Plan), "cadencr-plan");
    }

    #[test]
    fn cadence_mcp_metadata_is_derived_from_server_tool_catalog() {
        let plan_tools = cadence_mcp_required_tools("cadencr-plan");
        assert!(plan_tools.contains(&"show_plan".to_string()));
        assert!(plan_tools.contains(&"mark_agent_done".to_string()));
        assert!(cadence_mcp_uses_approval_elicitation("cadencr-plan"));
        assert!(cadence_mcp_tool_requires_approval_elicitation(
            "cadencr-plan",
            "show_plan"
        ));
        assert!(!cadence_mcp_tool_requires_approval_elicitation(
            "cadencr-plan",
            "read_plan"
        ));

        let prd_tools = cadence_mcp_required_tools("cadencr-prd");
        assert!(prd_tools.contains(&"show_prd".to_string()));
        assert!(cadence_mcp_tool_requires_approval_elicitation(
            "cadencr-prd",
            "show_prd"
        ));
    }

    #[test]
    fn cadence_mcp_metadata_accepts_legacy_cadence_prefix() {
        assert!(cadence_mcp_required_tools("cadence-plan").contains(&"show_plan".to_string()));
    }
}
