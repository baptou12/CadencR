mod codex_cli;
pub(crate) mod opencode;

use super::adapter::AgentRuntimeAdapter;
use super::runtime::{AgentCatalogResponse, DEFAULT_PROVIDER};

/// All registered runtime adapters. Add new providers here.
static ADAPTERS: &[(&str, &dyn AgentRuntimeAdapter)] = &[
    ("claude_code", &super::claude_code::CLAUDE_CODE_ADAPTER),
    ("opencode", &super::opencode::OPENCODE_ADAPTER),
];

pub fn runtime_adapter(provider_id: &str) -> Option<&'static dyn AgentRuntimeAdapter> {
    ADAPTERS
        .iter()
        .find(|(id, _)| *id == provider_id)
        .map(|(_, adapter)| *adapter)
}

/// Find the adapter that claims a given model string (for auto-routing).
pub fn adapter_for_model(model: &str) -> Option<(&'static str, &'static dyn AgentRuntimeAdapter)> {
    ADAPTERS
        .iter()
        .find(|(_, adapter)| adapter.accepts_model(model))
        .map(|(id, adapter)| (*id, *adapter))
}

pub async fn provider_catalog_live() -> AgentCatalogResponse {
    let mut providers = Vec::with_capacity(ADAPTERS.len() + 1);
    for (_, adapter) in ADAPTERS {
        providers.push(adapter.catalog_entry_live().await);
    }
    providers.push(codex_cli::catalog_entry());
    AgentCatalogResponse {
        default_provider: DEFAULT_PROVIDER.to_string(),
        providers,
    }
}

pub fn spawn_runtime_startup_warmups() {
    for (_, adapter) in ADAPTERS {
        adapter.spawn_startup_warmup();
    }
}

pub async fn runtime_session_finished(provider_id: &str, runtime_session_id: &str) -> bool {
    let Some(adapter) = runtime_adapter(provider_id) else {
        return false;
    };

    adapter.session_finished(runtime_session_id).await
}

#[cfg(test)]
mod tests {
    use super::{adapter_for_model, runtime_adapter, ADAPTERS};

    #[test]
    fn runtime_adapter_registry_has_claude_and_opencode() {
        assert!(runtime_adapter("claude_code").is_some());
        assert!(runtime_adapter("opencode").is_some());
        assert!(runtime_adapter("codex_cli").is_none());
        assert!(runtime_adapter("unknown").is_none());
    }

    #[test]
    fn adapter_for_model_routes_opencode_refs() {
        let (id, _) = adapter_for_model("openai/gpt-5.4").expect("should find opencode adapter");
        assert_eq!(id, "opencode");
    }

    #[test]
    fn adapter_for_model_returns_none_for_plain_models() {
        assert!(adapter_for_model("claude-opus-4-6").is_none());
    }

    #[test]
    fn all_adapters_have_catalog_entries() {
        for (id, adapter) in ADAPTERS {
            let entry = adapter.catalog_entry();
            assert_eq!(&entry.id, id, "catalog entry id mismatch for {id}");
        }
    }
}
