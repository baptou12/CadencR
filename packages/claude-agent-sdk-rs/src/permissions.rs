use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Permission modes matching CLI --permission-mode flag.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Default,
    AcceptEdits,
    BypassPermissions,
    Plan,
    /// Classifier-backed mode (Claude Code v2.1.83+). A separate model
    /// auto-approves safe actions and blocks risky ones, so the CLI runs
    /// without per-tool prompts but with safety checks the user did not have
    /// to write themselves. Requires Sonnet 4.6 / Opus 4.6+ on Max/Team/
    /// Enterprise/API plans.
    Auto,
    DontAsk,
}

impl PermissionMode {
    /// Convert to CLI flag value.
    pub fn as_cli_flag(&self) -> &str {
        match self {
            Self::Default => "default",
            Self::AcceptEdits => "acceptEdits",
            Self::BypassPermissions => "bypassPermissions",
            Self::Plan => "plan",
            Self::Auto => "auto",
            Self::DontAsk => "dontAsk",
        }
    }
}

/// Suggested permission update (for "don't ask again" flows).
/// The wire format is opaque — we pass it through as a JSON blob.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionUpdate {
    #[serde(flatten)]
    pub data: serde_json::Value,
}

/// Context provided with a permission request.
/// Maps to the TS SDK's `canUseTool` options parameter.
#[derive(Debug, Clone)]
pub struct PermissionRequest {
    pub tool_name: String,
    pub input: serde_json::Value,
    pub tool_use_id: String,
    pub agent_id: Option<String>,
    /// Suggested permission updates so the user isn't prompted again.
    pub suggestions: Option<Vec<PermissionUpdate>>,
    /// File path that triggered the request.
    pub blocked_path: Option<String>,
    /// Why this permission was triggered.
    pub decision_reason: Option<String>,
}

/// Result of a permission check.
/// Serialized on the wire as `{ "behavior": "allow"|"deny", ... }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "behavior")]
pub enum PermissionResult {
    #[serde(rename = "allow")]
    Allow {
        #[serde(rename = "updatedInput")]
        updated_input: serde_json::Value,
        #[serde(rename = "updatedPermissions", skip_serializing_if = "Option::is_none")]
        updated_permissions: Option<Vec<PermissionUpdate>>,
        #[serde(rename = "toolUseId", skip_serializing_if = "Option::is_none")]
        tool_use_id: Option<String>,
    },
    #[serde(rename = "deny")]
    Deny {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        interrupt: Option<bool>,
        #[serde(rename = "toolUseId", skip_serializing_if = "Option::is_none")]
        tool_use_id: Option<String>,
    },
}

/// The core permission callback trait.
///
/// **Turn-blocking semantics**: When the CLI requests tool permission, the SDK
/// calls this trait method and BLOCKS the message stream until it returns.
/// This is the mechanism for three critical "waiting for user" states:
///
/// 1. **AskUserQuestion**: `tool_name = "AskUserQuestion"`, `input` contains
///    the question. Implementor should present it to the user, await the
///    answer, and return `Allow` with `updated_input` containing the answer.
///
/// 2. **ExitPlanMode**: `tool_name = "ExitPlanMode"`, signals the plan is
///    ready for approval. Return `Allow` to approve or `Deny` to reject.
///
/// 3. **Tool permissions**: Any tool requiring explicit permission. Implementor
///    should prompt the user and return `Allow` or `Deny` accordingly.
///
/// Because this trait method is `async`, implementors can use channels,
/// one-shot futures, or any async mechanism to wait for user input.
#[async_trait]
pub trait CanUseTool: Send + Sync {
    async fn can_use_tool(&self, request: PermissionRequest) -> PermissionResult;
}

/// Default implementation that allows all tools unconditionally.
pub struct AllowAllTools;

#[async_trait]
impl CanUseTool for AllowAllTools {
    async fn can_use_tool(&self, request: PermissionRequest) -> PermissionResult {
        PermissionResult::Allow {
            updated_input: request.input,
            updated_permissions: None,
            tool_use_id: Some(request.tool_use_id),
        }
    }
}
