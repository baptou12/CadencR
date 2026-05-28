//! Provider-neutral facade for importing existing conversations from external
//! AI providers (Claude Code today; Codex/OpenCode planned). The HTTP surface
//! is `domain::imports::routes`; provider-specific parsing lives in submodules
//! like `claude_code_jsonl` so generic code only ever deals with the
//! provider-neutral `ImportedConversation` type.

mod block_extract;
pub mod claude_code_jsonl;
pub mod jobs;
pub mod models;
pub mod routes;
pub mod service;
