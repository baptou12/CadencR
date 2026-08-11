use crate::domain::agents::adapter::RuntimeError;

impl From<codex_app_server_sdk_rs::SdkError> for RuntimeError {
    fn from(value: codex_app_server_sdk_rs::SdkError) -> Self {
        match value {
            codex_app_server_sdk_rs::SdkError::CliNotFound { searched } => {
                Self::cli_not_found("codex", searched)
            }
            other => Self::Generic(other.to_string()),
        }
    }
}
