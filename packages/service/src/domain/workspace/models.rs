use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub use crate::domain::agents::runtime::ProviderSettings as AgentProviderSettings;

#[derive(Debug, Serialize, ToSchema)]
pub struct Setting {
    pub key: String,
    pub value: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ModelSettings {
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
    pub auto_name: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetSettingRequest {
    pub value: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetModelSettingRequest {
    pub agent_type: String,
    pub model_id: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetProviderSettingRequest {
    pub agent_type: String,
    pub provider_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_setting_serialization() {
        let s = Setting {
            key: "theme".to_string(),
            value: Some("dark".to_string()),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"key\":\"theme\""));
        assert!(json.contains("\"value\":\"dark\""));
    }

    #[test]
    fn test_setting_null_value_serialization() {
        let s = Setting {
            key: "missing".to_string(),
            value: None,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"value\":null"));
    }

    #[test]
    fn test_model_settings_serialization() {
        let ms = ModelSettings {
            plan: "opus[1m]".to_string(),
            prd: "opus[1m]".to_string(),
            execute: "opus[1m]".to_string(),
            risk: "opus[1m]".to_string(),
            review: "opus[1m]".to_string(),
            review_fixer: "opus[1m]".to_string(),
            session: "opus[1m]".to_string(),
            qa: "opus[1m]".to_string(),
            retro: "opus[1m]".to_string(),
            auto_name: "haiku".to_string(),
        };
        let json = serde_json::to_string(&ms).unwrap();
        // review_fixer should be serialized as "review-fixer"
        assert!(json.contains("\"review-fixer\""));
        assert!(!json.contains("\"review_fixer\""));
        assert!(json.contains("\"auto_name\""));
    }

    #[test]
    fn test_model_settings_default_values() {
        let default_model = "opus[1m]";
        let ms = ModelSettings {
            plan: default_model.to_string(),
            prd: default_model.to_string(),
            execute: default_model.to_string(),
            risk: default_model.to_string(),
            review: default_model.to_string(),
            review_fixer: default_model.to_string(),
            session: default_model.to_string(),
            qa: default_model.to_string(),
            retro: default_model.to_string(),
            auto_name: default_model.to_string(),
        };
        assert_eq!(ms.plan, default_model);
        assert_eq!(ms.prd, default_model);
        assert_eq!(ms.execute, default_model);
        assert_eq!(ms.risk, default_model);
        assert_eq!(ms.review, default_model);
        assert_eq!(ms.review_fixer, default_model);
        assert_eq!(ms.session, default_model);
        assert_eq!(ms.qa, default_model);
        assert_eq!(ms.retro, default_model);
        assert_eq!(ms.auto_name, default_model);
    }

    #[test]
    fn test_set_setting_request_deserialization() {
        let json = r#"{"value":"dark"}"#;
        let req: SetSettingRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.value, "dark");
    }

    #[test]
    fn test_set_model_setting_request_deserialization() {
        let json = r#"{"agent_type":"plan","model_id":"claude-sonnet-3-5"}"#;
        let req: SetModelSettingRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.agent_type, "plan");
        assert_eq!(req.model_id, "claude-sonnet-3-5");
    }
}
