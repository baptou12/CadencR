//! How far an MCP write tool reaches: the project server writes inside the
//! caller's own project, the workspace server writes across every project.
//!
//! One enum shared by the control-plane handlers and the MCP tool clients, so a
//! tool name, its endpoint, and its audit server name can never drift apart.
//! Mirrors `send_message_tool::SendMessageTool` for the write pair.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WriteScope {
    Project,
    Workspace,
}

impl WriteScope {
    pub(crate) fn server_name(self) -> &'static str {
        match self {
            Self::Project => "cadencr-project",
            Self::Workspace => "cadencr-workspace",
        }
    }

    pub(crate) fn update_feature_tool(self) -> &'static str {
        match self {
            Self::Project => "project_update_feature",
            Self::Workspace => "workspace_update_feature",
        }
    }

    pub(crate) fn stop_session_tool(self) -> &'static str {
        match self {
            Self::Project => "project_stop_session",
            Self::Workspace => "workspace_stop_session",
        }
    }

    pub(crate) fn update_feature_endpoint(self) -> &'static str {
        match self {
            Self::Project => "/internal/mcp/project/update-feature",
            Self::Workspace => "/internal/mcp/workspace/update-feature",
        }
    }

    pub(crate) fn stop_session_endpoint(self) -> &'static str {
        match self {
            Self::Project => "/internal/mcp/project/stop-session",
            Self::Workspace => "/internal/mcp/workspace/stop-session",
        }
    }

    /// Whether the target may live outside the caller's project. Workspace
    /// writes may, which is exactly why they demand the Steward grant on the
    /// source feature (see `control::steward`).
    pub(crate) fn allows_cross_project(self) -> bool {
        matches!(self, Self::Workspace)
    }
}

#[cfg(test)]
mod tests {
    use super::WriteScope;

    #[test]
    fn each_scope_names_its_own_tools_endpoints_and_server() {
        assert_eq!(WriteScope::Project.server_name(), "cadencr-project");
        assert_eq!(WriteScope::Workspace.server_name(), "cadencr-workspace");
        assert_eq!(
            WriteScope::Workspace.update_feature_tool(),
            "workspace_update_feature"
        );
        assert_eq!(
            WriteScope::Workspace.stop_session_tool(),
            "workspace_stop_session"
        );
        assert_eq!(
            WriteScope::Workspace.update_feature_endpoint(),
            "/internal/mcp/workspace/update-feature"
        );
        assert_eq!(
            WriteScope::Workspace.stop_session_endpoint(),
            "/internal/mcp/workspace/stop-session"
        );
    }

    #[test]
    fn only_workspace_writes_leave_the_callers_project() {
        assert!(!WriteScope::Project.allows_cross_project());
        assert!(WriteScope::Workspace.allows_cross_project());
    }
}
