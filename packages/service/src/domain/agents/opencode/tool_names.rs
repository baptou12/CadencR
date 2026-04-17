//! Normalize OpenCode-emitted tool names to the canonical Cadence MCP format.
//!
//! Claude Code emits MCP tool calls as `mcp__<server>__<tool>`; OpenCode emits
//! them as `<server>_<tool>`. The frontend tool parser only recognizes the
//! Claude form, so we rewrite at the adapter boundary.

use crate::domain::mcp::servers::AgentType;

const CADENCE_MCP_PREFIX: &str = "mcp__cadence-";
const CADENCE_SERVER_PREFIX: &str = "cadence-";

/// Rewrite `cadence-<server>_<tool>` → `mcp__cadence-<server>__<tool>`.
/// Leaves names that are already canonical or unrelated untouched.
pub(in crate::domain::agents::opencode) fn canonical_cadence_tool_name(name: &str) -> String {
    if name.starts_with(CADENCE_MCP_PREFIX) {
        return name.to_string();
    }
    let Some(rest) = name.strip_prefix(CADENCE_SERVER_PREFIX) else {
        return name.to_string();
    };
    for agent in AgentType::ALL {
        let server = agent.short_name();
        if let Some(tool) = rest.strip_prefix(server).and_then(|s| s.strip_prefix('_')) {
            return format!("mcp__cadence-{server}__{tool}");
        }
    }
    name.to_string()
}

#[cfg(test)]
mod tests {
    use super::canonical_cadence_tool_name;

    #[test]
    fn rewrites_opencode_cadence_tool_names() {
        assert_eq!(
            canonical_cadence_tool_name("cadence-plan_update_plan"),
            "mcp__cadence-plan__update_plan"
        );
        assert_eq!(
            canonical_cadence_tool_name("cadence-execute_mark_phase_done"),
            "mcp__cadence-execute__mark_phase_done"
        );
        assert_eq!(
            canonical_cadence_tool_name("cadence-session_create_phase"),
            "mcp__cadence-session__create_phase"
        );
    }

    #[test]
    fn passes_through_already_canonical_names() {
        assert_eq!(
            canonical_cadence_tool_name("mcp__cadence-plan__update_plan"),
            "mcp__cadence-plan__update_plan"
        );
    }

    #[test]
    fn passes_through_non_cadence_tools() {
        assert_eq!(canonical_cadence_tool_name("Bash"), "Bash");
        assert_eq!(canonical_cadence_tool_name("Read"), "Read");
        assert_eq!(canonical_cadence_tool_name("custom_tool"), "custom_tool");
    }

    #[test]
    fn leaves_unknown_cadence_servers_alone() {
        assert_eq!(
            canonical_cadence_tool_name("cadence-unknown_some_tool"),
            "cadence-unknown_some_tool"
        );
    }
}
