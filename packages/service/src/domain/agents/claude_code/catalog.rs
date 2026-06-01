use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use crate::domain::agents::adapter::{RuntimeSlashCommand, RuntimeSlashCommandKind};
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ModelProbeCacheKey(u64);

pub(super) fn model_probe_cache_key(env: Option<&HashMap<String, String>>) -> ModelProbeCacheKey {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let Some(env) = env.filter(|env| !env.is_empty()) else {
        0u8.hash(&mut hasher);
        return ModelProbeCacheKey(hasher.finish());
    };

    1u8.hash(&mut hasher);
    let mut entries = env.iter().collect::<Vec<_>>();
    entries.sort_by(|(left, _), (right, _)| left.cmp(right));
    for (key, value) in entries {
        key.hash(&mut hasher);
        0xffu8.hash(&mut hasher);
        value.hash(&mut hasher);
        0xfeu8.hash(&mut hasher);
    }
    ModelProbeCacheKey(hasher.finish())
}

pub(super) fn apply_model_probe_result(
    cache: &std::sync::RwLock<Vec<ModelCatalogEntry>>,
    probe_state: &mut ProbeState,
    cache_key: ModelProbeCacheKey,
    result: Result<Vec<ModelCatalogEntry>, String>,
) {
    match result {
        Ok(models) if !models.is_empty() => {
            if let Ok(mut cached_models) = cache.write() {
                *cached_models = models;
            }
            probe_state.live = true;
            probe_state.live_key = Some(cache_key);
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
        self.default_model_id_with_env(None).await
    }

    /// Env-aware variant of [`default_model_id`]. Probes the catalog under the
    /// active profile env so the default is resolved against the same model
    /// list the picker shows — and crucially under the same cache key, so the
    /// default-model probe and the catalog probe never thrash the shared cell.
    pub(super) async fn default_model_id_with_env(
        &self,
        env: Option<HashMap<String, String>>,
    ) -> Option<String> {
        let models = self.load_models_with_env(env).await;
        Self::default_model_from(&models)
    }

    pub(super) fn models_cell(&self) -> &std::sync::RwLock<Vec<ModelCatalogEntry>> {
        self.cached_models
            .get_or_init(|| std::sync::RwLock::new(fallback_models()))
    }

    pub(super) async fn load_models(&self) -> Vec<ModelCatalogEntry> {
        self.load_models_with_env(None).await
    }

    pub(super) async fn load_models_with_env(
        &self,
        env: Option<HashMap<String, String>>,
    ) -> Vec<ModelCatalogEntry> {
        let cache_key = model_probe_cache_key(env.as_ref());
        let mut guard = self.probe_state.lock().await;
        if guard.live_key != Some(cache_key) {
            let cwd = std::env::temp_dir().to_string_lossy().into_owned();
            let probe_result = claude_agent_sdk_rs::supported_models_with_env(&cwd, None, env)
                .await
                .map(|models| {
                    models
                        .into_iter()
                        .map(sdk_model_to_catalog_entry)
                        .collect::<Vec<_>>()
                })
                .map_err(|error| error.to_string());
            apply_model_probe_result(self.models_cell(), &mut guard, cache_key, probe_result);
        }
        let cache_matches_request = guard.live_key == Some(cache_key);
        drop(guard);
        if cache_matches_request {
            self.models_cell()
                .read()
                .map(|models| models.clone())
                .unwrap_or_else(|_| fallback_models())
        } else {
            fallback_models()
        }
    }

    pub(super) fn slash_commands_cell(&self) -> &std::sync::RwLock<Vec<RuntimeSlashCommand>> {
        self.cached_slash_commands
            .get_or_init(|| std::sync::RwLock::new(Vec::new()))
    }

    /// Probe the CLI for its built-in slash commands once per process
    /// (retrying on empty results) and return the cached list. The SDK call
    /// is infallible — empty is the only "failure" mode we observe here.
    pub(super) async fn load_builtin_slash_commands(&self) -> Vec<RuntimeSlashCommand> {
        let mut guard = self.slash_commands_probe_state.lock().await;
        if !guard.live {
            let live: Vec<RuntimeSlashCommand> = claude_agent_sdk_rs::list_builtin_commands(None)
                .await
                .into_iter()
                .map(sdk_slash_to_runtime)
                .collect();
            if live.is_empty() {
                tracing::warn!(
                    "Claude Code CLI returned empty built-in slash-command list; will retry"
                );
            } else if let Ok(mut cached) = self.slash_commands_cell().write() {
                *cached = live;
                guard.live = true;
            }
        }
        drop(guard);
        self.slash_commands_cell()
            .read()
            .map(|commands| commands.clone())
            .unwrap_or_default()
    }

    pub(super) fn default_model_from(models: &[ModelCatalogEntry]) -> Option<String> {
        models
            .iter()
            .find(|model| model.id == "default")
            .map(|model| model.id.clone())
            .or_else(|| models.first().map(|model| model.id.clone()))
    }
}

// Claude Code exposes skills and slash commands through the same init
// `slash_commands` list, so the adapter keeps them all as `/` commands.
fn sdk_slash_to_runtime(command: claude_agent_sdk_rs::SlashCommand) -> RuntimeSlashCommand {
    RuntimeSlashCommand {
        name: command.name,
        description: command.description,
        kind: RuntimeSlashCommandKind::Command,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::domain::agents::runtime::ModelCatalogEntry;

    use super::{
        apply_model_probe_result, model_probe_cache_key, sdk_model_to_catalog_entry,
        ClaudeCodeAdapter, ProbeState,
    };

    fn new_test_adapter() -> ClaudeCodeAdapter {
        ClaudeCodeAdapter {
            cached_models: std::sync::OnceLock::new(),
            probe_state: tokio::sync::Mutex::new(ProbeState::default()),
            cached_slash_commands: std::sync::OnceLock::new(),
            slash_commands_probe_state: tokio::sync::Mutex::new(ProbeState::default()),
        }
    }

    /// Regression for the catalog-cache thrash: the env-aware default-model
    /// resolution must read the catalog cached under the *same* profile env
    /// key, not re-probe with a different key. Here the cell is pre-seeded and
    /// marked live for the Bedrock env, so `default_model_id_with_env` must
    /// hit that cache (returning the Bedrock model) and leave `live_key`
    /// untouched — proving it can't clobber the picker's env-aware catalog.
    #[tokio::test]
    async fn default_model_id_with_env_reuses_catalog_cache_key() {
        let adapter = new_test_adapter();
        let mut env = HashMap::new();
        env.insert("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string());
        env.insert(
            "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
            "us.anthropic.claude-sonnet-4-6".to_string(),
        );
        let env_key = model_probe_cache_key(Some(&env));

        {
            let mut cached = adapter.models_cell().write().expect("cache lock");
            *cached = vec![ModelCatalogEntry::alias(
                "us.anthropic.claude-sonnet-4-6",
                "Sonnet",
            )];
        }
        {
            let mut guard = adapter.probe_state.lock().await;
            guard.live_key = Some(env_key);
        }

        let default = adapter.default_model_id_with_env(Some(env)).await;
        assert_eq!(default.as_deref(), Some("us.anthropic.claude-sonnet-4-6"));

        // The cache stayed live for the Bedrock env key — no None-keyed re-probe.
        let guard = adapter.probe_state.lock().await;
        assert_eq!(guard.live_key, Some(env_key));
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
        let cache_key = model_probe_cache_key(None);

        apply_model_probe_result(
            adapter.models_cell(),
            &mut probe_state,
            cache_key,
            Ok(vec![ModelCatalogEntry::alias("default", "Default")]),
        );

        let cached = adapter.models_cell().read().expect("cache lock");
        assert_eq!(probe_state.live_key, Some(cache_key));
        assert_eq!(cached[0].id, "default");
    }

    #[test]
    fn apply_model_probe_result_keeps_fallback_models_when_empty() {
        let adapter = new_test_adapter();
        let mut probe_state = ProbeState::default();

        apply_model_probe_result(
            adapter.models_cell(),
            &mut probe_state,
            model_probe_cache_key(None),
            Ok(vec![]),
        );

        let cached = adapter.models_cell().read().expect("cache lock");
        assert!(probe_state.live_key.is_none());
        assert_eq!(cached[0].id, "opus");
    }

    #[test]
    fn apply_model_probe_result_keeps_fallback_models_on_error() {
        let adapter = new_test_adapter();
        let mut probe_state = ProbeState::default();

        apply_model_probe_result(
            adapter.models_cell(),
            &mut probe_state,
            model_probe_cache_key(None),
            Err("boom".to_string()),
        );

        let cached = adapter.models_cell().read().expect("cache lock");
        assert!(probe_state.live_key.is_none());
        assert_eq!(cached[0].id, "opus");
    }

    #[test]
    fn model_probe_cache_key_is_stable_for_env_ordering() {
        let mut env_a = HashMap::new();
        env_a.insert("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string());
        env_a.insert(
            "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
            "us.anthropic.claude-sonnet-4-6".to_string(),
        );
        let mut env_b = HashMap::new();
        env_b.insert(
            "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
            "us.anthropic.claude-sonnet-4-6".to_string(),
        );
        env_b.insert("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string());

        assert_eq!(
            model_probe_cache_key(Some(&env_a)),
            model_probe_cache_key(Some(&env_b))
        );
    }

    #[test]
    fn model_probe_cache_key_changes_when_env_value_changes() {
        let mut env_a = HashMap::new();
        env_a.insert(
            "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
            "us.anthropic.claude-sonnet-4-6".to_string(),
        );
        let mut env_b = HashMap::new();
        env_b.insert(
            "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
            "us.anthropic.claude-sonnet-4-7".to_string(),
        );

        assert_ne!(
            model_probe_cache_key(Some(&env_a)),
            model_probe_cache_key(Some(&env_b))
        );
    }
}
