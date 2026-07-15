use crate::domain::agents::runtime_adapter;

pub(super) fn should_clear_for_model(
    runtime_provider: &str,
    model_id: &str,
    thinking_effort: Option<&str>,
) -> bool {
    let Some(effort) = thinking_effort else {
        return false;
    };

    runtime_adapter(runtime_provider)
        .and_then(|adapter| adapter.supports_thinking_effort_level(model_id, effort))
        == Some(false)
}

pub(super) fn filter_for_model(
    runtime_provider: &str,
    model_id: Option<&str>,
    thinking_effort: Option<String>,
) -> (Option<String>, bool) {
    let Some(model_id) = model_id else {
        return (thinking_effort, false);
    };

    if !should_clear_for_model(runtime_provider, model_id, thinking_effort.as_deref()) {
        return (thinking_effort, false);
    }

    (None, true)
}
