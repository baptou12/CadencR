//! OpenCode provider catalog & model lookup.
//!
//! The live catalog comes from a short-lived `opencode serve` subprocess
//! (see `probe.rs`) that we spawn just long enough to hit
//! `GET /config/providers` on its embedded HTTP backend. That endpoint
//! is a pure config listing — no upstream model API calls, no token
//! usage. Results are cached with a 30s TTL (see `cache.rs`).

mod cache;
mod probe;

use std::collections::HashMap;

use opencode_sdk_rs::ConfigProvidersResponse;

use crate::domain::agents::runtime::{ModelCatalogEntry, ProviderCatalogEntry, ProviderStatus};

const PROVIDER_ID: &str = "opencode";
const PROVIDER_LABEL: &str = "OpenCode";
const FALLBACK_MODEL_ID: &str = "default/default";
const OPENCODE_FALLBACK_CONTEXT_WINDOW: u64 = 200_000;

/// Static catalog used before the live probe has run (and as the
/// failure fallback inside `cache::live_catalog_entry_with`).
pub(crate) fn catalog_entry() -> ProviderCatalogEntry {
    ProviderCatalogEntry {
        id: PROVIDER_ID.to_string(),
        label: PROVIDER_LABEL.to_string(),
        status: ProviderStatus::Available,
        status_message: None,
        models: vec![ModelCatalogEntry {
            id: FALLBACK_MODEL_ID.to_string(),
            label: "Default".to_string(),
            description: None,
            supports_effort: Some(false),
            supported_effort_levels: None,
            supports_adaptive_thinking: None,
            supports_fast_mode: None,
            supports_auto_mode: None,
        }],
        default_model: Some(FALLBACK_MODEL_ID.to_string()),
    }
}

pub(crate) async fn catalog_entry_live() -> ProviderCatalogEntry {
    (*cache::live_catalog().await).clone()
}

pub(crate) async fn context_window_for_model(model_id: &str) -> Option<u64> {
    let entry = cache::live_catalog_entry().await;
    Some(
        entry
            .context_windows
            .get(model_id)
            .copied()
            .unwrap_or(OPENCODE_FALLBACK_CONTEXT_WINDOW),
    )
}

pub(crate) async fn default_model_id() -> Option<String> {
    cache::live_catalog().await.default_model.clone()
}

/// Provider-specific shaping of the wire response. Returns the
/// FE-facing catalog + a `model id → context window` lookup table the
/// cache stores alongside it.
///
/// opencode's wire-side `default` is `{ providerID → modelID }` (one
/// entry per provider). Cadencr's catalog wants a single default, so
/// we pick the first model whose `providerID/modelID` matches an
/// entry in that map — a single pass over the providers builds both
/// the model list and resolves the default in one shot.
fn catalog_from_response(
    response: ConfigProvidersResponse,
) -> (ProviderCatalogEntry, HashMap<String, u64>) {
    let mut models = Vec::new();
    let mut context_windows = HashMap::new();
    let mut default_model_from_wire = None;
    for provider in &response.providers {
        let provider_label = provider.name.clone().unwrap_or_else(|| provider.id.clone());
        let wire_default = response.default.get(&provider.id);
        for model in &provider.models {
            let id = format!("{}/{}", provider.id, model.id);
            let model_label = model.name.clone().unwrap_or_else(|| model.id.clone());
            if let Some(context) = model.limit.as_ref().and_then(|limit| limit.context) {
                context_windows.insert(id.clone(), context);
            }
            if default_model_from_wire.is_none() && wire_default == Some(&model.id) {
                default_model_from_wire = Some(id.clone());
            }
            models.push(ModelCatalogEntry {
                id,
                label: format!("{provider_label}: {model_label}"),
                description: None,
                supports_effort: None,
                supported_effort_levels: None,
                supports_adaptive_thinking: None,
                supports_fast_mode: None,
                supports_auto_mode: None,
            });
        }
    }

    let default_model = default_model_from_wire
        .or_else(|| models.first().map(|model| model.id.clone()))
        .or_else(|| Some(FALLBACK_MODEL_ID.to_string()));

    let catalog = ProviderCatalogEntry {
        id: PROVIDER_ID.to_string(),
        label: PROVIDER_LABEL.to_string(),
        status: ProviderStatus::Available,
        status_message: None,
        models,
        default_model,
    };
    (catalog, context_windows)
}

#[cfg(test)]
mod tests {
    use super::{
        catalog_entry, catalog_from_response, context_window_for_model, FALLBACK_MODEL_ID,
        OPENCODE_FALLBACK_CONTEXT_WINDOW,
    };
    use crate::domain::agents::runtime::ProviderStatus;
    use opencode_sdk_rs::ConfigProvidersResponse;
    use serde_json::json;

    use super::cache::TEST_LOCK;

    fn parse(value: serde_json::Value) -> ConfigProvidersResponse {
        serde_json::from_value(value).expect("fixture parses")
    }

    #[test]
    fn fallback_catalog_entry_is_available() {
        let entry = catalog_entry();
        assert_eq!(entry.id, "opencode");
        assert_eq!(entry.status, ProviderStatus::Available);
        assert_eq!(entry.default_model.as_deref(), Some(FALLBACK_MODEL_ID));
        assert_eq!(entry.models.len(), 1);
    }

    #[test]
    fn catalog_from_response_uses_default_provider_model() {
        let response = parse(json!({
            "providers": [
                {
                    "id": "anthropic",
                    "name": "Anthropic",
                    "models": {
                        "claude-sonnet-4-5": {
                            "name": "Claude Sonnet 4.5",
                            "limit": { "context": 200000 }
                        },
                        "claude-haiku-4-5": {
                            "name": "Claude Haiku 4.5"
                        }
                    }
                }
            ],
            "default": { "anthropic": "claude-sonnet-4-5" }
        }));
        let (catalog, windows) = catalog_from_response(response);
        assert_eq!(
            catalog.default_model.as_deref(),
            Some("anthropic/claude-sonnet-4-5")
        );
        assert_eq!(catalog.models.len(), 2);
        let sonnet = catalog
            .models
            .iter()
            .find(|m| m.id == "anthropic/claude-sonnet-4-5")
            .expect("sonnet entry");
        assert_eq!(sonnet.label, "Anthropic: Claude Sonnet 4.5");
        assert_eq!(
            windows.get("anthropic/claude-sonnet-4-5").copied(),
            Some(200_000)
        );
        assert!(!windows.contains_key("anthropic/claude-haiku-4-5"));
    }

    #[test]
    fn catalog_from_response_falls_back_to_first_model_when_default_missing() {
        let response = parse(json!({
            "providers": [
                {
                    "id": "local",
                    "models": { "default": {} }
                }
            ]
        }));
        let (catalog, _) = catalog_from_response(response);
        assert_eq!(catalog.default_model.as_deref(), Some("local/default"));
    }

    #[test]
    fn catalog_from_response_falls_back_to_static_when_empty() {
        let response = parse(json!({ "providers": [] }));
        let (catalog, windows) = catalog_from_response(response);
        assert_eq!(catalog.default_model.as_deref(), Some(FALLBACK_MODEL_ID));
        assert!(windows.is_empty());
    }

    #[tokio::test]
    async fn context_window_returns_cached_window_when_present() {
        let _guard = TEST_LOCK.lock().await;
        super::cache::reset_for_test().await;
        let probe = || async {
            Ok(parse(json!({
                "providers": [
                    {
                        "id": "anthropic",
                        "models": {
                            "claude-sonnet-4-5": { "limit": { "context": 250000 } }
                        }
                    }
                ]
            })))
        };
        // Seed the cache through the probe seam.
        let _ = super::cache::live_catalog_entry_with(probe).await;
        // Re-read via the public path which uses the same cache.
        let window = context_window_for_model("anthropic/claude-sonnet-4-5").await;
        assert_eq!(window, Some(250_000));
        super::cache::reset_for_test().await;
    }

    #[tokio::test]
    async fn context_window_falls_back_for_unknown_model() {
        let _guard = TEST_LOCK.lock().await;
        super::cache::reset_for_test().await;
        let probe = || async {
            Ok(parse(json!({
                "providers": [
                    {
                        "id": "anthropic",
                        "models": {
                            "claude-sonnet-4-5": { "limit": { "context": 250000 } }
                        }
                    }
                ]
            })))
        };
        let _ = super::cache::live_catalog_entry_with(probe).await;
        let window = context_window_for_model("unknown/model").await;
        assert_eq!(window, Some(OPENCODE_FALLBACK_CONTEXT_WINDOW));
        super::cache::reset_for_test().await;
    }
}
