use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub const AGENT_TYPES: &[&str] = &[
    "plan",
    "prd",
    "execute",
    "risk",
    "review",
    "review-fixer",
    "session",
    "qa",
    "retro",
];

pub const DEFAULT_PROVIDER: &str = "claude_code";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProviderStatus {
    Available,
    ComingSoon,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ModelCatalogEntry {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_effort: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supported_effort_levels: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_adaptive_thinking: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_fast_mode: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_auto_mode: Option<bool>,
}

impl ModelCatalogEntry {
    /// Bare alias constructor for catalog entries that don't carry capability
    /// flags or descriptions (e.g. fallback lists and third-party providers
    /// that only expose id/label).
    pub fn alias(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            description: None,
            supports_effort: None,
            supported_effort_levels: None,
            supports_adaptive_thinking: None,
            supports_fast_mode: None,
            supports_auto_mode: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ProviderCatalogEntry {
    pub id: String,
    pub label: String,
    pub status: ProviderStatus,
    pub models: Vec<ModelCatalogEntry>,
    pub default_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentCatalogResponse {
    pub default_provider: String,
    pub providers: Vec<ProviderCatalogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ProviderSettings {
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

pub fn validate_agent_type(agent_type: &str) -> bool {
    AGENT_TYPES.contains(&agent_type)
}

pub fn runtime_setting_key(agent_type: &str) -> String {
    format!("agent_runtime_{agent_type}")
}

pub fn default_provider_settings() -> ProviderSettings {
    let default = DEFAULT_PROVIDER.to_string();
    ProviderSettings {
        plan: default.clone(),
        prd: default.clone(),
        execute: default.clone(),
        risk: default.clone(),
        review: default.clone(),
        review_fixer: default.clone(),
        session: default.clone(),
        qa: default.clone(),
        retro: default,
    }
}

#[cfg(test)]
mod tests {
    use super::{default_provider_settings, validate_agent_type, DEFAULT_PROVIDER};

    #[test]
    fn validates_supported_agent_types() {
        assert!(validate_agent_type("plan"));
        assert!(validate_agent_type("session"));
        assert!(!validate_agent_type("unknown"));
    }

    #[test]
    fn default_provider_settings_use_default_for_all_agent_types() {
        let settings = default_provider_settings();

        assert_eq!(settings.plan, DEFAULT_PROVIDER);
        assert_eq!(settings.prd, DEFAULT_PROVIDER);
        assert_eq!(settings.execute, DEFAULT_PROVIDER);
        assert_eq!(settings.risk, DEFAULT_PROVIDER);
        assert_eq!(settings.review, DEFAULT_PROVIDER);
        assert_eq!(settings.review_fixer, DEFAULT_PROVIDER);
        assert_eq!(settings.session, DEFAULT_PROVIDER);
        assert_eq!(settings.qa, DEFAULT_PROVIDER);
        assert_eq!(settings.retro, DEFAULT_PROVIDER);
    }
}
