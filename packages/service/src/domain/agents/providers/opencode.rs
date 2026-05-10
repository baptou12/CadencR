//! OpenCode provider catalog & model lookup.
//!
//! With the legacy OpenCode HTTP transport gone, there is no long-running
//! HTTP server to query for the live model list; both `catalog_entry_live`
//! and `context_window_for_model` fall back to the static catalog below.
//!
//! TODO(opencode-acp): wire real model discovery through the ACP path —
//! either by spawning a short-lived `opencode acp --port` subprocess and
//! hitting `/config/providers` on its embedded HTTP backend, or by reading
//! the on-disk OpenCode config directly. Until then the FE shows only the
//! fallback `default/default` entry for OpenCode.

use crate::domain::agents::runtime::{ModelCatalogEntry, ProviderCatalogEntry, ProviderStatus};

const FALLBACK_MODEL_ID: &str = "default/default";
const OPENCODE_FALLBACK_CONTEXT_WINDOW: u64 = 200_000;

pub(crate) fn catalog_entry() -> ProviderCatalogEntry {
    ProviderCatalogEntry {
        id: "opencode".to_string(),
        label: "OpenCode".to_string(),
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
    catalog_entry()
}

pub(crate) async fn context_window_for_model(_model_id: &str) -> Option<u64> {
    // No live catalog fetch on the ACP path yet (see module docstring).
    // Returning the fallback window is honest enough: the FE will surface
    // it as a static cap, and the per-turn `usage_update` notification
    // from ACP keeps real consumption tracking accurate.
    Some(OPENCODE_FALLBACK_CONTEXT_WINDOW)
}

#[cfg(test)]
mod tests {
    use super::catalog_entry;
    use crate::domain::agents::runtime::ProviderStatus;

    #[test]
    fn fallback_catalog_entry_is_available() {
        let entry = catalog_entry();
        assert_eq!(entry.id, "opencode");
        assert_eq!(entry.status, ProviderStatus::Available);
        assert_eq!(entry.default_model.as_deref(), Some("default/default"));
        assert_eq!(entry.models.len(), 1);
    }
}
