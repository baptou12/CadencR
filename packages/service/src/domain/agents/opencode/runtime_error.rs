use crate::domain::agents::adapter::RuntimeError;

impl From<opencode_sdk_rs::SdkError> for RuntimeError {
    fn from(value: opencode_sdk_rs::SdkError) -> Self {
        match value {
            opencode_sdk_rs::SdkError::CliNotFound { searched } => {
                Self::cli_not_found("opencode", searched)
            }
            other => Self::Generic(other.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::RuntimeError;

    #[test]
    fn cli_not_found_maps_to_structured_runtime_error() {
        let searched = vec![std::path::PathBuf::from("/custom/opencode")];
        let error = RuntimeError::from(opencode_sdk_rs::SdkError::CliNotFound {
            searched: searched.clone(),
        });
        assert!(matches!(
            error,
            RuntimeError::CliNotFound {
                ref provider,
                searched: ref actual,
            } if provider == "opencode" && *actual == searched
        ));
    }
}
