//! Normalize OpenCode-emitted tool names to the canonical Cadencr MCP format.
//!
//! Claude Code emits MCP tool calls as `mcp__<server>__<tool>`; OpenCode emits
//! them as `<server>_<tool>`. The frontend tool parser only recognizes the
//! Claude form, so we rewrite at the adapter boundary.

use crate::domain::mcp::servers::AgentType;

const CADENCR_MCP_PREFIX: &str = "mcp__cadencr-";
const CADENCR_SERVER_PREFIX: &str = "cadencr-";

/// Rewrite `cadencr-<server>_<tool>` → `mcp__cadencr-<server>__<tool>`.
/// Leaves names that are already canonical or unrelated untouched.
pub(in crate::domain::agents::opencode) fn canonical_cadencr_tool_name(name: &str) -> String {
    if name.starts_with(CADENCR_MCP_PREFIX) {
        return name.to_string();
    }
    let Some(rest) = name.strip_prefix(CADENCR_SERVER_PREFIX) else {
        return name.to_string();
    };
    for agent in AgentType::ALL {
        let server = agent.short_name();
        if let Some(tool) = rest.strip_prefix(server).and_then(|s| s.strip_prefix('_')) {
            return format!("{CADENCR_MCP_PREFIX}{server}__{tool}");
        }
    }
    name.to_string()
}

#[cfg(test)]
mod tests {
    use super::canonical_cadencr_tool_name;

    #[test]
    fn rewrites_opencode_cadencr_tool_names() {
        assert_eq!(
            canonical_cadencr_tool_name("cadencr-plan_update_plan"),
            "mcp__cadencr-plan__update_plan"
        );
        assert_eq!(
            canonical_cadencr_tool_name("cadencr-execute_mark_phase_done"),
            "mcp__cadencr-execute__mark_phase_done"
        );
        assert_eq!(
            canonical_cadencr_tool_name("cadencr-session_create_phase"),
            "mcp__cadencr-session__create_phase"
        );
    }

    #[test]
    fn passes_through_already_canonical_names() {
        assert_eq!(
            canonical_cadencr_tool_name("mcp__cadencr-plan__update_plan"),
            "mcp__cadencr-plan__update_plan"
        );
    }

    #[test]
    fn passes_through_non_cadencr_tools() {
        assert_eq!(canonical_cadencr_tool_name("Bash"), "Bash");
        assert_eq!(canonical_cadencr_tool_name("Read"), "Read");
        assert_eq!(canonical_cadencr_tool_name("custom_tool"), "custom_tool");
    }

    #[test]
    fn leaves_unknown_cadencr_servers_alone() {
        assert_eq!(
            canonical_cadencr_tool_name("cadencr-unknown_some_tool"),
            "cadencr-unknown_some_tool"
        );
    }
}
