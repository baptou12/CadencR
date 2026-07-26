#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SendMessageTool {
    Project,
    Workspace,
}

impl SendMessageTool {
    pub(crate) fn server_name(self) -> &'static str {
        match self {
            Self::Project => "cadencr-project",
            Self::Workspace => "cadencr-workspace",
        }
    }

    pub(crate) fn tool_name(self) -> &'static str {
        match self {
            Self::Project => "project_send_session_message",
            Self::Workspace => "workspace_send_session_message",
        }
    }

    pub(crate) fn endpoint(self) -> &'static str {
        match self {
            Self::Project => "/internal/mcp/project/send-message",
            Self::Workspace => "/internal/mcp/workspace/send-message",
        }
    }

    pub(crate) fn allows_cross_project(self) -> bool {
        matches!(self, Self::Workspace)
    }
}
