use crate::app_state::AppState;
use crate::domain::agents::providers::{
    model_supports_thinking_level, validate_thinking_level_or_error,
};
use crate::domain::agents::runtime::ModelCatalogEntry;
use crate::domain::settings;
use crate::error::AppError;

use super::trimmed_optional;

pub(super) async fn resolve(
    state: &AppState,
    effective_provider: &str,
    model: Option<ModelCatalogEntry>,
    requested_level: Option<&str>,
) -> Result<Option<String>, AppError> {
    if let Some(thinking_level) = trimmed_optional(requested_level) {
        if let Some(model) = model.as_ref() {
            validate_thinking_level_or_error(effective_provider, model, &thinking_level)
                .map_err(|error| AppError::BadRequest(error.to_string()))?;
        }
        return Ok(Some(thinking_level));
    }

    let Some(model) = model else {
        return Ok(None);
    };
    if model.supports_effort == Some(false)
        || model
            .supported_effort_levels
            .as_ref()
            .is_some_and(Vec::is_empty)
    {
        return Ok(None);
    }

    let last_used =
        settings::thinking_effort_model_default(&state.read_pool, effective_provider, &model.id)
            .await;
    Ok(select_omitted_level(&model, last_used))
}

fn select_omitted_level(model: &ModelCatalogEntry, last_used: Option<String>) -> Option<String> {
    if let Some(level) = trimmed_optional(last_used.as_deref()) {
        if model_supports_thinking_level(model, &level) != Some(false) {
            return Some(level);
        }
    }

    model
        .default_effort_level
        .clone()
        .filter(|level| model_supports_thinking_level(model, level) != Some(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn effort_model(default_effort_level: Option<&str>) -> ModelCatalogEntry {
        ModelCatalogEntry {
            id: "target-model".to_string(),
            label: "Target Model".to_string(),
            description: None,
            supports_effort: Some(true),
            supported_effort_levels: Some(vec!["low".to_string(), "high".to_string()]),
            default_effort_level: default_effort_level.map(ToOwned::to_owned),
            supports_adaptive_thinking: None,
            supports_fast_mode: None,
            supports_auto_mode: None,
        }
    }

    #[test]
    fn omitted_level_prefers_target_models_last_used_level() {
        let selected = select_omitted_level(&effort_model(Some("low")), Some("high".to_string()));

        assert_eq!(selected.as_deref(), Some("high"));
    }

    #[test]
    fn omitted_level_uses_cli_default_for_unused_model() {
        let selected = select_omitted_level(&effort_model(Some("low")), None);

        assert_eq!(selected.as_deref(), Some("low"));
    }

    #[test]
    fn stale_last_used_level_falls_back_to_cli_default() {
        let selected = select_omitted_level(
            &effort_model(Some("low")),
            Some("removed-level".to_string()),
        );

        assert_eq!(selected.as_deref(), Some("low"));
    }

    #[tokio::test]
    async fn stored_level_is_scoped_to_target_provider_and_model() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::domain::settings_store::global_set(
            &settings::thinking_effort_model_key("target-provider", "target-model"),
            "high",
        )
        .await
        .unwrap();
        crate::domain::settings_store::global_set(
            &settings::thinking_effort_model_key("other-provider", "target-model"),
            "low",
        )
        .await
        .unwrap();

        let selected =
            settings::thinking_effort_model_default(&pool, "target-provider", "target-model").await;

        assert_eq!(selected.as_deref(), Some("high"));
    }
}
