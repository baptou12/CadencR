//! Provider-neutral ACP runtime layer.
//!
//! Lifted out of `domain::agents::opencode::acp::*` in W1 so multiple ACP
//! providers can share this code. Provider-specific behavior plugs in
//! through the [`provider_hooks::AcpProviderHooks`] trait.

pub mod config_options;
pub mod event_loop_state;
pub mod events;
pub mod events_config_option;
pub mod events_plan;
pub mod events_stream_blocks;
pub mod events_tool_call;
mod events_tool_call_input;
mod events_tool_call_result;
pub mod events_tool_call_update;
pub mod fs;
pub mod lifecycle;
pub mod mcp;
pub mod permissions;
mod permissions_dispatch;
pub mod prompt_turn;
pub mod provider_hooks;
pub mod server_requests;
pub mod session;
pub mod session_permissions;
pub mod session_spawn;
mod terminal_enrich;
mod terminal_io;
pub mod terminal_registry;
mod terminal_sandbox;
pub mod turn_lifecycle;
pub mod turn_result;

pub use session_spawn::{spawn_acp_runtime_session, AcpRuntimeSpawnArgs};
