pub mod adapter;
pub mod claude_code;
pub mod codex;
pub mod discovery;
pub mod model_refs;
pub mod opencode;
pub mod providers;
pub mod response_style;
pub mod runtime;

pub use discovery::apply_binary_overrides_from_settings;
pub use providers::{
    adapter_for_model, resolve_effective_provider, runtime_adapter, runtime_session_finished,
    spawn_runtime_startup_warmups,
};
