use crate::domain::agents::adapter::RuntimeError;

impl From<cursor_agent_sdk_rs::SdkError> for RuntimeError {
    fn from(value: cursor_agent_sdk_rs::SdkError) -> Self {
        match value {
            cursor_agent_sdk_rs::SdkError::CliNotFound { searched } => {
                Self::cli_not_found("agent", searched)
            }
            other => Self::Generic(other.to_string()),
        }
    }
}
