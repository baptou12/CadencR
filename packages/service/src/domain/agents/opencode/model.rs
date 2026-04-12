use crate::domain::agents::adapter::RuntimePermissionMode;

pub fn parse_model_ref(raw: &str) -> Option<opencode_sdk_rs::ModelRef> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some((provider_id, model_id)) = trimmed.split_once('/') {
        return Some(opencode_sdk_rs::ModelRef {
            provider_id: provider_id.to_string(),
            model_id: model_id.to_string(),
        });
    }
    Some(opencode_sdk_rs::ModelRef {
        provider_id: "default".to_string(),
        model_id: trimmed.to_string(),
    })
}

pub fn permission_mode_agent(mode: Option<RuntimePermissionMode>) -> &'static str {
    if matches!(mode, Some(RuntimePermissionMode::Plan)) {
        "plan"
    } else {
        "build"
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_model_ref, permission_mode_agent};
    use crate::domain::agents::adapter::RuntimePermissionMode;

    #[test]
    fn parse_model_ref_supports_provider_and_flat_models() {
        let split = parse_model_ref("anthropic/claude-sonnet").unwrap();
        assert_eq!(split.provider_id, "anthropic");
        assert_eq!(split.model_id, "claude-sonnet");

        let flat = parse_model_ref("claude-sonnet").unwrap();
        assert_eq!(flat.provider_id, "default");
        assert_eq!(flat.model_id, "claude-sonnet");
    }

    #[test]
    fn parse_model_ref_rejects_empty_string() {
        assert!(parse_model_ref("").is_none());
        assert!(parse_model_ref("   ").is_none());
    }

    #[test]
    fn permission_mode_to_agent_maps_plan_to_plan_agent() {
        assert_eq!(
            permission_mode_agent(Some(RuntimePermissionMode::Plan)),
            "plan"
        );
        assert_eq!(
            permission_mode_agent(Some(RuntimePermissionMode::AcceptEdits)),
            "build"
        );
    }
}
