use crate::domain::agents::adapter::RuntimeError;

impl From<claude_agent_sdk_rs::SdkError> for RuntimeError {
    fn from(value: claude_agent_sdk_rs::SdkError) -> Self {
        match value {
            claude_agent_sdk_rs::SdkError::CliNotFound { searched } => {
                Self::cli_not_found("claude", searched)
            }
            claude_agent_sdk_rs::SdkError::ControlRequestFailed { subtype, message } => {
                Self::ControlRequestRejected { subtype, message }
            }
            other => Self::Generic(other.to_string()),
        }
    }
}
