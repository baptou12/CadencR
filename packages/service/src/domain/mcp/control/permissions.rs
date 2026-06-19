use crate::error::AppError;

pub(super) fn ensure_side_effect_enabled(
    setting_key: &str,
    tool_name: &str,
) -> Result<(), AppError> {
    match crate::domain::settings_store::global_get(setting_key).as_deref() {
        Some("true") => Ok(()),
        Some("false") => Err(AppError::BadRequest(format!(
            "{tool_name} is disabled by workspace setting {setting_key}",
        ))),
        _ => Err(AppError::BadRequest(format!(
            "{tool_name} requires explicit enablement; set {setting_key}=true",
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::ensure_side_effect_enabled;
    use crate::domain::settings_store::global_write_content;

    #[tokio::test]
    async fn ask_policy_does_not_allow_silent_side_effects() {
        global_write_content(r#"{"project_mcp_allow_spawn":"ask"}"#)
            .await
            .unwrap();

        let error = ensure_side_effect_enabled("project_mcp_allow_spawn", "project_spawn_session")
            .unwrap_err();

        assert!(error.to_string().contains("requires explicit enablement"));
    }
}
