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

/// Resolve the effective provider for a (configured_provider, model) pair.
///
/// Users commonly change *just* the model — e.g. at project level they pick
/// `openai/gpt-5.4` — without touching the provider setting, which stays at
/// the default. When that happens, route to the adapter that owns the model
/// so the agent actually spawns on the right backend. Explicit non-default
/// provider choices are always preserved.
pub fn resolve_effective_provider(provider_id: String, model: Option<&str>) -> String {
    if provider_id == DEFAULT_PROVIDER {
        if let Some(model) = model {
            if let Some((adapter_id, _)) = adapter_for_model(model) {
                return adapter_id.to_string();
            }
        }
    }
    provider_id
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

pub async fn provider_default_model(provider_id: &str) -> Option<String> {
    if let Some(adapter) = runtime_adapter(provider_id) {
        return adapter.default_model_id().await;
    }

    if provider_id == "codex_cli" {
        return codex_cli::catalog_entry().default_model;
    }

    None
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
    use super::{adapter_for_model, resolve_effective_provider, runtime_adapter, ADAPTERS};

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

    #[test]
    fn resolve_effective_provider_reroutes_default_when_model_belongs_to_other_adapter() {
        let routed =
            resolve_effective_provider("claude_code".to_string(), Some("openai/gpt-5.4"));
        assert_eq!(routed, "opencode");
    }

    #[test]
    fn resolve_effective_provider_preserves_default_for_native_claude_model() {
        let routed = resolve_effective_provider("claude_code".to_string(), Some("claude-opus-4-6"));
        assert_eq!(routed, "claude_code");
    }

    #[test]
    fn resolve_effective_provider_preserves_explicit_non_default_provider() {
        // User explicitly chose opencode — don't rewrite even if the model looks claude-ish
        let routed = resolve_effective_provider("opencode".to_string(), Some("claude-opus-4-6"));
        assert_eq!(routed, "opencode");
    }

    #[test]
    fn resolve_effective_provider_without_model_is_passthrough() {
        let routed = resolve_effective_provider("claude_code".to_string(), None);
        assert_eq!(routed, "claude_code");
    }
}
