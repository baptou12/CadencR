use std::borrow::Cow;
use std::fmt::{Display, Formatter};
use std::path::PathBuf;

#[derive(Debug)]
pub enum RuntimeError {
    /// Generic runtime failure with a free-form message.
    Generic(String),
    /// The provider's CLI binary could not be located on disk. Carries the
    /// directories that were probed so the host can render an actionable
    /// message and prompt the user to set an explicit path via onboarding.
    CliNotFound {
        /// Owned so a runtime-registered provider can report its own CLI name
        /// without a compile-time literal.
        provider: Cow<'static, str>,
        searched: Vec<PathBuf>,
    },
    /// The provider's CLI accepted the protocol envelope but rejected the
    /// requested operation (e.g. `set_permission_mode("auto")` on a model
    /// that doesn't support auto). `subtype` is the control-request
    /// subtype the SDK sent — callers (e.g. the post-plan-approval
    /// transition) can branch on this to apply a fallback. `message` is
    /// the CLI's verbatim error text.
    ControlRequestRejected { subtype: String, message: String },
    /// A manual compaction turn failed after the compact request had already
    /// been accepted by Cadencr. The host can clear compact-specific UI state
    /// without treating unrelated steering failures as compact failures.
    CompactFailed(String),
}

impl Display for RuntimeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Generic(message) => f.write_str(message),
            Self::CliNotFound { provider, searched } => {
                write!(
                    f,
                    "{provider} CLI not found; searched {} location(s)",
                    searched.len()
                )
            }
            Self::ControlRequestRejected { subtype, message } => {
                write!(f, "CLI rejected control request `{subtype}`: {message}")
            }
            Self::CompactFailed(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for RuntimeError {}

impl RuntimeError {
    pub fn new(message: impl Into<String>) -> Self {
        Self::Generic(message.into())
    }

    pub fn compact_failed(message: impl Into<String>) -> Self {
        Self::CompactFailed(message.into())
    }

    /// Build a structured "CLI not found" error so the host can surface an
    /// actionable message + a link to the binary picker in onboarding.
    pub fn cli_not_found(provider: impl Into<Cow<'static, str>>, searched: Vec<PathBuf>) -> Self {
        Self::CliNotFound {
            provider: provider.into(),
            searched,
        }
    }
}

impl From<claude_agent_sdk_rs::SdkError> for RuntimeError {
    fn from(value: claude_agent_sdk_rs::SdkError) -> Self {
        match value {
            claude_agent_sdk_rs::SdkError::CliNotFound { searched } => {
                Self::cli_not_found("claude", searched)
            }
            // Preserve the structured rejection so adapters can apply
            // command-specific fallbacks (e.g. post-plan `auto` →
            // `acceptEdits`). Without this, the variant flattens to a
            // string and the only way to recover would be substring
            // matching on the message.
            claude_agent_sdk_rs::SdkError::ControlRequestFailed { subtype, message } => {
                Self::ControlRequestRejected { subtype, message }
            }
            other => Self::Generic(other.to_string()),
        }
    }
}

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

#[cfg(test)]
mod tests {
    use super::RuntimeError;

    #[test]
    fn opencode_cli_not_found_maps_to_structured_runtime_error() {
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
