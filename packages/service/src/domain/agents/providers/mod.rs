mod claude_code;
mod codex_cli;
mod opencode;

use super::adapter::AgentRuntimeAdapter;
use super::runtime::{AgentCatalogResponse, DEFAULT_PROVIDER};

pub fn runtime_adapter(provider_id: &str) -> Option<&'static dyn AgentRuntimeAdapter> {
    match provider_id {
        "claude_code" => Some(&super::claude_code::CLAUDE_CODE_ADAPTER),
        "opencode" => Some(&super::opencode::OPENCODE_ADAPTER),
        _ => None,
    }
}

pub fn legacy_session_id_value(provider_id: &str, runtime_session_id: &str) -> Option<String> {
    match provider_id {
        "claude_code" => Some(runtime_session_id.to_string()),
        _ => None,
    }
}

pub fn provider_catalog() -> AgentCatalogResponse {
    AgentCatalogResponse {
        default_provider: DEFAULT_PROVIDER.to_string(),
        providers: vec![
            claude_code::catalog_entry(),
            codex_cli::catalog_entry(),
            opencode::catalog_entry(),
        ],
    }
}

pub async fn provider_catalog_live() -> AgentCatalogResponse {
    let mut catalog = provider_catalog();
    if let Some(entry) = catalog
        .providers
        .iter_mut()
        .find(|provider| provider.id == "opencode")
    {
        *entry = opencode::catalog_entry_live().await;
    }
    catalog
}

pub fn spawn_runtime_startup_warmups() {
    opencode::spawn_startup_warmup();
}

#[cfg(test)]
mod tests {
    use super::{legacy_session_id_value, runtime_adapter};

    #[test]
    fn runtime_adapter_registry_has_claude_and_opencode() {
        assert!(runtime_adapter("claude_code").is_some());
        assert!(runtime_adapter("opencode").is_some());
        assert!(runtime_adapter("codex_cli").is_none());
        assert!(runtime_adapter("unknown").is_none());
    }

    #[test]
    fn legacy_session_mapping_is_provider_scoped() {
        assert_eq!(
            legacy_session_id_value("claude_code", "abc"),
            Some("abc".to_string())
        );
        assert_eq!(legacy_session_id_value("opencode", "abc"), None);
    }
}
