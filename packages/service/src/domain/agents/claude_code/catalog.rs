use crate::domain::agents::runtime::ModelCatalogEntry;

use super::{ClaudeCodeAdapter, ProbeState};

pub(super) fn fallback_models() -> Vec<ModelCatalogEntry> {
    vec![
        ModelCatalogEntry::alias("opus", "Opus"),
        ModelCatalogEntry::alias("sonnet", "Sonnet"),
        ModelCatalogEntry::alias("haiku", "Haiku"),
    ]
}

pub(super) fn sdk_model_to_catalog_entry(
    model: claude_agent_sdk_rs::ModelInfo,
) -> ModelCatalogEntry {
    ModelCatalogEntry {
        id: model.value,
        label: model.display_name,
        description: model.description,
        supports_effort: model.supports_effort,
        supported_effort_levels: model.supported_effort_levels,
        supports_adaptive_thinking: model.supports_adaptive_thinking,
        supports_fast_mode: model.supports_fast_mode,
        supports_auto_mode: model.supports_auto_mode,
    }
}

pub(super) fn apply_model_probe_result(
    cache: &std::sync::RwLock<Vec<ModelCatalogEntry>>,
    probe_state: &mut ProbeState,
    result: Result<Vec<ModelCatalogEntry>, String>,
) {
    match result {
        Ok(models) if !models.is_empty() => {
            if let Ok(mut cached_models) = cache.write() {
                *cached_models = models;
            }
            probe_state.live = true;
        }
        Ok(_) => {
            tracing::warn!(
                "Claude Code CLI returned empty model list; will retry on next catalog request"
            );
        }
        Err(error) => {
            tracing::warn!(
                error = %error,
                "Claude Code CLI model probe failed; will retry on next catalog request"
            );
        }
    }
}

impl ClaudeCodeAdapter {
    /// Return the CLI's preferred default model ID (`"default"` if present,
    /// else the first model in the list).
    pub(super) async fn default_model_id(&self) -> Option<String> {
        let models = self.load_models().await;
        Self::default_model_from(&models)
    }

    pub(super) fn models_cell(&self) -> &std::sync::RwLock<Vec<ModelCatalogEntry>> {
        self.cached_models
            .get_or_init(|| std::sync::RwLock::new(fallback_models()))
    }

    pub(super) async fn load_models(&self) -> Vec<ModelCatalogEntry> {
        let mut guard = self.probe_state.lock().await;
        if !guard.live {
            let cwd = std::env::temp_dir().to_string_lossy().into_owned();
            let probe_result = claude_agent_sdk_rs::supported_models(&cwd, None)
                .await
                .map(|models| {
                    models
                        .into_iter()
                        .map(sdk_model_to_catalog_entry)
                        .collect::<Vec<_>>()
                })
                .map_err(|error| error.to_string());
            apply_model_probe_result(self.models_cell(), &mut guard, probe_result);
        }
        drop(guard);
        self.models_cell()
            .read()
            .map(|models| models.clone())
            .unwrap_or_else(|_| fallback_models())
    }

    pub(super) fn default_model_from(models: &[ModelCatalogEntry]) -> Option<String> {
        models
            .iter()
            .find(|model| model.id == "default")
            .map(|model| model.id.clone())
            .or_else(|| models.first().map(|model| model.id.clone()))
    }
}

#[cfg(test)]
mod tests {
    use crate::domain::agents::runtime::ModelCatalogEntry;

    use super::{
        apply_model_probe_result, sdk_model_to_catalog_entry, ClaudeCodeAdapter, ProbeState,
    };

    fn new_test_adapter() -> ClaudeCodeAdapter {
        ClaudeCodeAdapter {
            cached_models: std::sync::OnceLock::new(),
            probe_state: tokio::sync::Mutex::new(ProbeState::default()),
        }
    }

    #[test]
    fn sdk_model_to_catalog_entry_maps_all_fields() {
        let sdk = claude_agent_sdk_rs::ModelInfo {
            value: "default".to_string(),
            display_name: "Default (recommended)".to_string(),
            description: Some("Opus 4.7 with 1M context".to_string()),
            supports_effort: Some(true),
            supported_effort_levels: Some(vec!["low".to_string(), "max".to_string()]),
            supports_adaptive_thinking: Some(true),
            supports_fast_mode: None,
            supports_auto_mode: Some(true),
        };
        let entry = sdk_model_to_catalog_entry(sdk);
        assert_eq!(entry.id, "default");
        assert_eq!(entry.label, "Default (recommended)");
        assert_eq!(
            entry.description.as_deref(),
            Some("Opus 4.7 with 1M context")
        );
        assert_eq!(entry.supports_effort, Some(true));
        assert_eq!(entry.supports_auto_mode, Some(true));
        assert_eq!(entry.supports_fast_mode, None);
    }

    #[test]
    fn default_model_from_prefers_default_entry() {
        let models = vec![
            ModelCatalogEntry::alias("sonnet", "Sonnet"),
            ModelCatalogEntry::alias("default", "Default"),
        ];
        assert_eq!(
            ClaudeCodeAdapter::default_model_from(&models).as_deref(),
            Some("default")
        );
    }

    #[test]
    fn default_model_from_falls_back_to_first() {
        let models = vec![
            ModelCatalogEntry::alias("opus", "Opus"),
            ModelCatalogEntry::alias("haiku", "Haiku"),
        ];
        assert_eq!(
            ClaudeCodeAdapter::default_model_from(&models).as_deref(),
            Some("opus")
        );
    }

    #[test]
    fn apply_model_probe_result_marks_cache_live_on_success() {
        let adapter = new_test_adapter();
        let mut probe_state = ProbeState::default();

        apply_model_probe_result(
            adapter.models_cell(),
            &mut probe_state,
            Ok(vec![ModelCatalogEntry::alias("default", "Default")]),
        );

        let cached = adapter.models_cell().read().expect("cache lock");
        assert!(probe_state.live);
        assert_eq!(cached[0].id, "default");
    }

    #[test]
    fn apply_model_probe_result_keeps_fallback_models_when_empty() {
        let adapter = new_test_adapter();
        let mut probe_state = ProbeState::default();

        apply_model_probe_result(adapter.models_cell(), &mut probe_state, Ok(vec![]));

        let cached = adapter.models_cell().read().expect("cache lock");
        assert!(!probe_state.live);
        assert_eq!(cached[0].id, "opus");
    }

    #[test]
    fn apply_model_probe_result_keeps_fallback_models_on_error() {
        let adapter = new_test_adapter();
        let mut probe_state = ProbeState::default();

        apply_model_probe_result(
            adapter.models_cell(),
            &mut probe_state,
            Err("boom".to_string()),
        );

        let cached = adapter.models_cell().read().expect("cache lock");
        assert!(!probe_state.live);
        assert_eq!(cached[0].id, "opus");
    }
}
