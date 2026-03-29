use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub branch_prefix: Option<String>,
    pub qa_prompt: Option<String>,
    pub agent_autonomy: Option<String>,
    pub parallel_execution: Option<String>,
    pub constitution: Option<String>,
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
    pub plan: String,
    pub prd: String,
    pub execute: String,
    pub risk: String,
    pub review: String,
    #[serde(rename = "review-fixer")]
    pub review_fixer: String,
    pub session: String,
    pub qa: String,
    pub retro: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetProjectModelSettingRequest {
    pub model_type: String,
    pub model: String,
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
            qa_prompt: None,
            agent_autonomy: Some("supervised".to_string()),
            parallel_execution: None,
            constitution: None,
            created_at: "2024-01-01T00:00:00".to_string(),
        };
        let json = serde_json::to_string(&project).unwrap();
        assert!(json.contains("Test Project"));
        assert!(json.contains("feat/"));
        // Verify null fields are serialized
        assert!(json.contains("null") || json.contains("qa_prompt"));
    }

    #[test]
    fn test_project_setting_serde_roundtrip() {
        let setting = ProjectSetting {
            key: "agent_autonomy".to_string(),
            value: Some("full".to_string()),
        };
        let json = serde_json::to_string(&setting).unwrap();
        let deserialized: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized["key"], "agent_autonomy");
        assert_eq!(deserialized["value"], "full");

        let setting_null = ProjectSetting {
            key: "missing_key".to_string(),
            value: None,
        };
        let json_null = serde_json::to_string(&setting_null).unwrap();
        assert!(json_null.contains("missing_key"));
    }

    #[test]
    fn test_project_model_settings_serde_roundtrip() {
        let settings = ProjectModelSettings {
            plan: "claude-3-opus".to_string(),
            prd: "".to_string(),
            execute: "claude-3-sonnet".to_string(),
            risk: "".to_string(),
            review: "".to_string(),
            review_fixer: "claude-3-haiku".to_string(),
            session: "".to_string(),
            qa: "".to_string(),
            retro: "".to_string(),
        };
        let json = serde_json::to_string(&settings).unwrap();
        // review-fixer uses rename
        assert!(json.contains("review-fixer"));
        assert!(json.contains("claude-3-haiku"));
        assert!(json.contains("claude-3-opus"));
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
        let json = r#"{"model_type": "execute", "model": "claude-3-5-sonnet"}"#;
        let req: SetProjectModelSettingRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.model_type, "execute");
        assert_eq!(req.model, "claude-3-5-sonnet");
    }
}
