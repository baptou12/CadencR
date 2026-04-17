pub mod error;
pub mod mcp;
pub mod messages;
pub mod options;
pub mod permissions;
pub mod query;
pub mod transport;
pub mod types;

// Re-export key public types for convenient top-level access.
pub use error::SdkError;
pub use mcp::McpServerConfig;
pub use messages::{
    AssistantMessageBody, ModelUsageInfo, SdkMessage, StreamEventData, SystemMessage,
};
pub use options::{Options, OptionsBuilder};
pub use permissions::{
    AllowAllTools, CanUseTool, PermissionMode, PermissionRequest, PermissionResult,
    PermissionUpdate,
};
pub use query::{query, supported_commands, supported_models, Query, TurnState};
pub use types::{
    AccountInfo, AgentInfo, CompactMetadata, ContentBlock, ContentDelta, McpServerStatus,
    ModelInfo, PermissionDenial, PluginInfo, SlashCommand, Usage,
};
