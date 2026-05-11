//! Minimal OpenCode SDK consumed by the Cadencr ACP runtime path.
//!
//! Originally included a full HTTP transport (long-lived `opencode serve`
//! client + SSE dispatcher + reconcile / event-parsing pipeline). With the
//! HTTP transport retired the surface here is now narrow: typed wire shapes
//! (`types::Message`, `MessagePart`, `Session`, …), binary discovery + CLI
//! override (`process::opencode_discovery_spec`,
//! `process::set_binary_override`, `process::resolve_binary`), and a thin
//! REST client whose only callers are the ACP `upstream_workaround` polling
//! sidecar (which hits the embedded HTTP backend exposed by every
//! `opencode acp --port` subprocess we spawn). Anything broader belongs in
//! a separate transport.

#![allow(clippy::should_implement_trait)]

pub mod client;
pub mod client_payload;
pub mod error;
pub mod parsing;
pub mod process;
mod tool_input;
pub mod types;

pub use client::OpenCodeClient;
pub use error::SdkError;
pub use parsing::{
    parse_message_from, parse_part_from, parse_permission_from, parse_question_from,
    parse_session_from,
};
pub use process::{opencode_discovery_spec, resolve_binary, set_binary_override};
pub use types::{
    Agent, Command, ConfigModelLimit, ConfigProvider, ConfigProviderModel, ConfigProvidersResponse,
    Message, MessagePart, MessageRole, ModelRef, PermissionRequest, Question, QuestionItem,
    QuestionOption, Session, SessionStatus, TokenCacheUsage, TokenUsage,
};
