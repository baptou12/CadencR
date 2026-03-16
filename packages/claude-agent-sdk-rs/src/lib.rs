pub mod error;
pub mod types;
pub mod messages;
pub mod options;
pub mod permissions;
pub mod mcp;
pub mod transport;
pub mod query;

// Re-export key public types for convenient top-level access.
pub use error::SdkError;
pub use types::{
    AccountInfo, AgentInfo, CompactMetadata, ContentBlock, ContentDelta, McpServerStatus,
    ModelInfo, PermissionDenial, PluginInfo, SlashCommand, Usage,
};
pub use messages::{SdkMessage, StreamEventData, SystemMessage, AssistantMessageBody};
pub use permissions::{
    AllowAllTools, CanUseTool, PermissionMode, PermissionRequest, PermissionResult,
    PermissionUpdate,
};
pub use options::{Options, OptionsBuilder};
pub use mcp::McpServerConfig;
pub use query::{query, supported_commands, Query, TurnState};
