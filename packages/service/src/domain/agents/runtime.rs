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
    pub context_window: u64,
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

pub fn provider_catalog() -> AgentCatalogResponse {
    let claude_models = crate::api::MODELS
        .iter()
        .map(|(id, label, context_window)| ModelCatalogEntry {
            id: (*id).to_string(),
            label: (*label).to_string(),
            context_window: *context_window,
        })
        .collect();

    AgentCatalogResponse {
        default_provider: DEFAULT_PROVIDER.to_string(),
        providers: vec![
            ProviderCatalogEntry {
                id: "claude_code".to_string(),
                label: "Claude Code".to_string(),
                status: ProviderStatus::Available,
                models: claude_models,
                default_model: Some(crate::api::DEFAULT_MODEL.to_string()),
            },
            ProviderCatalogEntry {
                id: "codex_cli".to_string(),
                label: "Codex CLI".to_string(),
                status: ProviderStatus::ComingSoon,
                models: vec![],
                default_model: None,
            },
            ProviderCatalogEntry {
                id: "opencode".to_string(),
                label: "OpenCode".to_string(),
                status: ProviderStatus::ComingSoon,
                models: vec![],
                default_model: None,
            },
        ],
    }
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
    use super::*;

    #[test]
    fn test_provider_catalog_marks_only_claude_as_available() {
        let catalog = provider_catalog();

        assert_eq!(catalog.default_provider, "claude_code");
        assert_eq!(catalog.providers.len(), 3);

        let claude = catalog
            .providers
            .iter()
            .find(|p| p.id == "claude_code")
            .unwrap();
        assert_eq!(claude.status, ProviderStatus::Available);
        assert!(!claude.models.is_empty());
        assert_eq!(
            claude.default_model.as_deref(),
            Some(crate::api::DEFAULT_MODEL)
        );

        let codex = catalog
            .providers
            .iter()
            .find(|p| p.id == "codex_cli")
            .unwrap();
        assert_eq!(codex.status, ProviderStatus::ComingSoon);
        assert!(codex.models.is_empty());
        assert!(codex.default_model.is_none());

        let opencode = catalog
            .providers
            .iter()
            .find(|p| p.id == "opencode")
            .unwrap();
        assert_eq!(opencode.status, ProviderStatus::ComingSoon);
        assert!(opencode.models.is_empty());
        assert!(opencode.default_model.is_none());
    }

    #[test]
    fn test_default_provider_settings_uses_default_for_all_agent_types() {
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
