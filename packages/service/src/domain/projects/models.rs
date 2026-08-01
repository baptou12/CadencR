use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub use crate::domain::agents::runtime::ProviderSettings as ProjectProviderSettings;

/// `projects.kind` for a project Cadencr created to give an agent a working
/// directory that isn't a user repository — today, one per user theme.
///
/// Deliberately invisible: every listing selects `kind = 'user'` (the column
/// default, so nothing the user added is affected), which keeps these out of
/// the sidebar, the unified agents grid and the MCP workspace tools. They are
/// created and deleted alongside whatever owns them.
pub const SYSTEM_PROJECT_KIND: &str = "system";

#[derive(Debug, Serialize, ToSchema)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub branch_prefix: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateProjectRequest {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectSetting {
    pub key: String,
    pub value: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetProjectSettingRequest {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectModelSettings {
    pub session: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetProjectModelSettingRequest {
    pub model_type: String,
    pub model: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetProjectProviderSettingRequest {
    pub provider_type: String,
    pub provider: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_serde_roundtrip() {
        let project = Project {
            id: 1,
            name: "Test Project".to_string(),
            path: "/tmp/test".to_string(),
            branch_prefix: Some("feat/".to_string()),
            created_at: "2024-01-01T00:00:00".to_string(),
        };
        let json = serde_json::to_string(&project).unwrap();
        assert!(json.contains("Test Project"));
        assert!(json.contains("feat/"));
    }

    #[test]
    fn test_create_project_request_deserialize() {
        let json = r#"{"name": "My Project", "path": "/home/user/project"}"#;
        let req: CreateProjectRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.name, "My Project");
        assert_eq!(req.path, "/home/user/project");
    }

    #[test]
    fn test_set_project_setting_request_deserialize() {
        let json = r#"{"key": "branch_prefix", "value": "feature/"}"#;
        let req: SetProjectSettingRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.key, "branch_prefix");
        assert_eq!(req.value, "feature/");
    }

    #[test]
    fn test_set_project_model_setting_request_deserialize() {
        let json = r#"{"model_type": "session", "model": "claude-3-5-sonnet"}"#;
        let req: SetProjectModelSettingRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.model_type, "session");
        assert_eq!(req.model, "claude-3-5-sonnet");
    }
}
