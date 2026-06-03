//! Dispatch-layer integration tests for the WebSocket session handler.
//!
//! Shared scaffolding (mock runtime sessions, `make_*` / `init_session*`
//! helpers, and the glob re-exports the tests reach for) lives in
//! [`support`]. The remaining files group the tests by responsibility.

mod support;

mod app;
mod codex_provider;
mod dispatch;
mod gate;
mod init;
mod model_effort;
mod permission;
mod permission_mode;
mod prompt;
mod provider;
mod stream_reader;
mod stream_reader_mcp;
