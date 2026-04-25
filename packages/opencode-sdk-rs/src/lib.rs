pub mod client;
pub mod client_payload;
pub mod error;
pub mod event_parsing;
pub mod parsing;
pub mod process;
mod server_health;
pub mod sse;
mod sse_reconcile;
mod tool_input;
pub mod types;

pub use client::{parse_command_invocation, OpenCodeClient};
pub use error::SdkError;
pub use event_parsing::parse_sse_event;
pub use parsing::{
    parse_message_from, parse_part_from, parse_permission_from, parse_question_from,
    parse_session_from,
};
pub use process::{
    opencode_discovery_spec, set_binary_override, OpenCodeServer, OpenCodeServerInfo,
};
pub use sse::{shared_dispatcher, SseDispatcher, SseStream};
pub use types::{
    Command, Message, MessagePart, MessageRole, ModelRef, PermissionReply, PermissionRequest,
    PromptOptions, PromptPart, Question, QuestionItem, QuestionOption, Session, SessionStatus,
    SseEvent, TokenCacheUsage, TokenUsage,
};
